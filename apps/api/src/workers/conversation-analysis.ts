/**
 * Conversation analysis BullMQ worker.
 *
 * Triggered when a conversation is resolved. It:
 *   1. Computes a quality score from CSAT rating + resolution time
 *   2. Looks for recurring patterns across recent high-quality conversations
 *   3. Generates a supervised `TemplateOptimization` proposal using Claude
 *
 * The optimizations are created with status="pending" — they require human
 * review/approval via the Configure > Optimizations UI.
 */

import { prisma } from '@botstudio/db'
import { createLlmAdapter } from '@botstudio/llm'
import { withLlmScope } from '../lib/llm-ledger.js'

const llm = createLlmAdapter()

// ── Quality score ─────────────────────────────────────────────────────────────
// Combines CSAT (60 %) + speed-of-resolution (40 %)
// Returns 0..1 where 1 = perfect
export function computeQualityScore(params: {
  csatRating: number | null   // 1=positive, -1=negative, null=unknown
  resolutionMs: number | null // null = not yet resolved
}): number {
  const { csatRating, resolutionMs } = params

  // CSAT component
  const csatScore = csatRating === 1 ? 1 : csatRating === -1 ? 0 : 0.5

  // Speed component — sigmoid centred at 5 min, capped at 0..1
  let speedScore = 0.5
  if (resolutionMs !== null) {
    const minutes = resolutionMs / 60_000
    // >30 min → 0.0, <1 min → 1.0, 5 min → ~0.5
    speedScore = Math.max(0, Math.min(1, 1 - minutes / 30))
  }

  return csatScore * 0.6 + speedScore * 0.4
}

// ── Generate an optimisation proposal ────────────────────────────────────────
async function generateOptimizationProposal(params: {
  tenantId:      string
  botId:         string
  botName:       string
  currentPrompt: string
  conversations: Array<{
    id:       string
    messages: Array<{ role: string; text: string }>
    score:    number
  }>
}): Promise<{ title: string; description: string; proposedValue: string } | null> {
  const { botName, currentPrompt, conversations } = params

  if (conversations.length < 2) return null

  const examples = conversations.slice(0, 5).map((c, i) => {
    const transcript = c.messages.map((m) => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.text}`).join('\n')
    return `### Example ${i + 1} (quality score: ${c.score.toFixed(2)})\n${transcript}`
  }).join('\n\n')

  const systemPrompt = `You are an AI assistant that improves chatbot system prompts based on real conversation evidence.
You will be shown high-quality resolved conversations and the current system prompt.
Your job is to suggest a CONCISE addition (max 3 sentences) to the system prompt that would help the bot handle similar conversations even better.
Return JSON with exactly these fields:
{
  "title": "short title (max 8 words)",
  "description": "1-sentence explanation of what this optimisation achieves",
  "proposedAddition": "the exact text to append to the system prompt"
}
Do NOT return the full prompt — only the addition.`

  try {
    let response = ''
    await llm.stream({
      messages: [{
        role: 'user',
        content: `Current bot name: ${botName}

Current system prompt:
"""
${currentPrompt}
"""

High-quality example conversations:
${examples}

Based on these examples, what should be added to the system prompt?`,
      }],
      systemPrompt,
      temperature: 0.3,
      maxTokens: 512,
      onChunk: (c) => { response += c },
    })

    // Extract JSON from the response
    const match = response.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as { title?: string; description?: string; proposedAddition?: string }
    if (!parsed.title || !parsed.proposedAddition) return null

    return {
      title:         parsed.title,
      description:   parsed.description ?? '',
      proposedValue: currentPrompt.trim() + '\n\n' + parsed.proposedAddition.trim(),
    }
  } catch { return null }
}

// ── Main analysis function ────────────────────────────────────────────────────
export async function analyseConversation(jobData: {
  conversationId: string
  tenantId:       string
  botId:          string
}): Promise<void> {
  const { conversationId, tenantId, botId } = jobData

  // ── 1. Load the just-resolved conversation ─────────────────────────────────
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      csatResponses: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  if (!conversation) return

  // ── 2. Compute quality score ───────────────────────────────────────────────
  const latestCsat = conversation.csatResponses[0]?.rating ?? null
  const createdAt = conversation.createdAt.getTime()
  const resolvedAt = conversation.resolvedAt?.getTime() ?? null
  const resolutionMs = resolvedAt ? resolvedAt - createdAt : null

  const qualityScore = computeQualityScore({ csatRating: latestCsat, resolutionMs })

  // Low quality conversations are not useful for positive pattern mining
  if (qualityScore < 0.6) return

  // ── 3. Pull recent high-quality conversations for this bot ─────────────────
  // We use a simple keyword approach (no embeddings needed for MVP)
  const recentHighQuality = await prisma.$queryRawUnsafe<Array<{
    id: string; createdAt: Date; resolvedAt: Date | null
  }>>(
    `SELECT c.id, c."createdAt", c."resolvedAt"
     FROM conversations c
     WHERE c."botId" = $1
       AND c."tenantId" = $2
       AND c.status = 'resolved'
       AND c."resolvedAt" >= now() - interval '30 days'
       AND c.id <> $3
     ORDER BY c."createdAt" DESC
     LIMIT 20`,
    botId, tenantId, conversationId,
  ) as Array<{ id: string; createdAt: Date; resolvedAt: Date | null }>

  // Score each one
  const scoredPeers: Array<{ id: string; score: number }> = []
  for (const peer of recentHighQuality) {
    const peerCsat = await prisma.csatResponse.findFirst({
      where: { conversationId: peer.id },
      orderBy: { createdAt: 'desc' },
    })
    const peerMs = peer.resolvedAt ? peer.resolvedAt.getTime() - peer.createdAt.getTime() : null
    const score = computeQualityScore({ csatRating: peerCsat?.rating ?? null, resolutionMs: peerMs })
    if (score >= 0.6) scoredPeers.push({ id: peer.id, score })
  }

  // Need at least 2 examples (including the current) to propose a pattern
  if (scoredPeers.length < 1) return

  // ── 4. Build message transcripts ──────────────────────────────────────────
  const allConvoIds = [conversationId, ...scoredPeers.slice(0, 4).map((p) => p.id)]
  const allConvos = await prisma.conversation.findMany({
    where: { id: { in: allConvoIds } },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })

  const formatted = allConvos.map((c) => ({
    id: c.id,
    score: c.id === conversationId ? qualityScore : (scoredPeers.find((p) => p.id === c.id)?.score ?? 0),
    messages: c.messages.map((m) => ({
      role:  m.authorKind === 'user' ? 'user' : 'bot',
      text:  typeof m.content === 'object' && m.content !== null
               ? ((m.content as Record<string, unknown>)['text'] as string | undefined) ?? ''
               : String(m.content ?? ''),
    })).filter((m) => m.text.length > 0),
  }))

  // ── 5. Get current system prompt ──────────────────────────────────────────
  const cfg = await prisma.botConfig.findUnique({ where: { botId } })
  const bot = await prisma.bot.findUnique({ where: { id: botId } })
  const currentPrompt = cfg?.systemPrompt ?? `You are a helpful assistant for ${bot?.name ?? 'this bot'}.`

  // ── 6. Ask LLM to generate a proposal ────────────────────────────────────
  const proposal = await generateOptimizationProposal({
    tenantId, botId,
    botName: bot?.name ?? 'Bot',
    currentPrompt,
    conversations: formatted,
  })
  if (!proposal) return

  // ── 7. Upsert a pending TemplateOptimization ──────────────────────────────
  // Check if an identical pending proposal already exists
  const existing = await prisma.templateOptimization.findFirst({
    where: { botId, tenantId, status: 'pending', title: proposal.title },
  })

  if (existing) {
    // Reinforce: bump evidence count + update avg score
    const newCount = existing.evidenceCount + 1
    const newAvg   = (existing.avgQualityScore * existing.evidenceCount + qualityScore) / newCount
    await prisma.templateOptimization.update({
      where: { id: existing.id },
      data: { evidenceCount: newCount, avgQualityScore: newAvg, updatedAt: new Date() },
    })
  } else {
    await prisma.templateOptimization.create({
      data: {
        tenantId, botId,
        kind:            'system_prompt',
        title:           proposal.title,
        description:     proposal.description,
        currentValue:    currentPrompt,
        proposedValue:   proposal.proposedValue,
        evidenceCount:   scoredPeers.length + 1,
        avgQualityScore: qualityScore,
        status:          'pending',
      },
    })
  }
}

// ── BullMQ worker entrypoint ──────────────────────────────────────────────────
export async function startConversationAnalysisWorker(): Promise<void> {
  try {
    const { Worker } = await import('bullmq')
    const ioredis = await import('ioredis')
    const IORedis = ioredis.default ?? ioredis as unknown as new (url: string, opts: object) => object

    const connection = new (IORedis as unknown as new (url: string, opts: object) => object)(
      process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: null },
    )

    new Worker('conversation-analysis', async (job) => {
      await withLlmScope(
        { source: 'summarisation', tenantId: job.data.tenantId, botId: job.data.botId, conversationId: job.data.conversationId },
        () => analyseConversation(job.data),
      )
    }, { connection, concurrency: 2 })

    console.log('[conversation-analysis worker] started')
  } catch (err) {
    console.warn('[conversation-analysis worker] not started:', err instanceof Error ? err.message : err)
  }
}
