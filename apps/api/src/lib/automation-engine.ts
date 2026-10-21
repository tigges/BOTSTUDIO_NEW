/**
 * automation-engine.ts
 *
 * Evaluates AutomationRule records and executes their actions when events
 * fire inside the platform.
 *
 * Usage (fire-and-forget — never blocks the request that triggered it):
 *   triggerRules('csat.submitted', { tenantId, botId, conversationId, csatRating: -1 }).catch(() => {})
 *
 * ── Triggers ─────────────────────────────────────────────────────────────────
 *   csat.submitted       — CSAT rating submitted (context: csatRating, hasComment)
 *   message.received     — Inbound message saved (context: messageContent, messageCount)
 *   conversation.resolved — Conversation marked resolved
 *   conversation.escalated — Conversation marked escalated
 *   sla.breached         — First time a conversation misses its SLA clock
 *   contact.created      — New contact created
 *
 * ── Conditions (conditions field = JSON string) ───────────────────────────────
 *   Empty string → always fire
 *   JSON array of {field, operator, value} objects
 *
 *   Available fields per trigger:
 *     csat.submitted:          csat_rating (-1|1), has_comment (true|false)
 *     message.received:        message_count (number), conversation_status (string)
 *     conversation.resolved:   resolution_minutes (number)
 *     conversation.escalated:  message_count (number)
 *     contact.created:         (no extra fields)
 *
 *   Operators: equals, not_equals, less_than, greater_than, contains, is_set
 *
 * ── Actions (actions field = string[]) ────────────────────────────────────────
 *   "notify_supervisor"           create Activity log entry visible in Audit Log
 *   "escalate"                    set conversation.status = 'escalated'
 *   "resolve"                     set conversation.status = 'resolved'
 *   "close"                       set conversation.status = 'closed'
 *   "add_label:<value>"           attach the label to the conversation (created if missing) and log it
 *   "send_message:<text>"         post a bot message into the conversation
 *   "assign_agent:<userId>"       assign conversation.assignedTo (or 'round_robin')
 *   "call_webhook"                dispatch webhooks registered for this event
 */

import { prisma } from '@botstudio/db'
import { fillNameTokens } from '@botstudio/shared'
import { dispatchWebhookEvent } from '../queues.js'
import { outcomeAfterStatus } from './chat-outcome.js'

// ── Context ───────────────────────────────────────────────────────────────────

export interface RuleContext {
  tenantId: string
  botId: string
  conversationId?: string
  /** Numeric fields for condition comparisons */
  csatRating?: number       // 1 | -1
  hasComment?: boolean
  messageCount?: number
  messageContent?: string
  conversationStatus?: string
  resolutionMinutes?: number
}

// ── Condition evaluation ──────────────────────────────────────────────────────

interface Condition {
  field: string
  operator: 'equals' | 'not_equals' | 'less_than' | 'greater_than' | 'contains' | 'is_set'
  /** Saved rules may hold numbers or booleans, e.g. csat_rating equals -1. */
  value: string | number | boolean
}

function resolveField(field: string, ctx: RuleContext): string {
  switch (field) {
    case 'csat_rating':          return String(ctx.csatRating ?? '')
    case 'has_comment':          return String(ctx.hasComment ?? false)
    case 'message_count':        return String(ctx.messageCount ?? '')
    case 'message_content':      return ctx.messageContent ?? ''
    case 'conversation_status':  return ctx.conversationStatus ?? ''
    case 'resolution_minutes':   return String(ctx.resolutionMinutes ?? '')
    default:                     return ''
  }
}

function evaluateCondition(cond: Condition, ctx: RuleContext): boolean {
  const actual = resolveField(cond.field, ctx)
  const expected = String(cond.value ?? '')
  switch (cond.operator) {
    case 'equals':       return actual === expected
    case 'not_equals':   return actual !== expected
    case 'less_than':    return parseFloat(actual) < parseFloat(expected)
    case 'greater_than': return parseFloat(actual) > parseFloat(expected)
    case 'contains':     return actual.toLowerCase().includes(expected.toLowerCase())
    case 'is_set':       return actual !== '' && actual !== 'undefined' && actual !== 'null'
    default:             return false
  }
}

export function evaluateConditions(conditionsRaw: string, ctx: RuleContext): boolean {
  if (!conditionsRaw.trim()) return true  // empty = always fire
  try {
    const conditions: Condition[] = JSON.parse(conditionsRaw)
    if (!Array.isArray(conditions) || conditions.length === 0) return true
    return conditions.every((c) => evaluateCondition(c, ctx))
  } catch {
    return true  // malformed = treat as always fire (fail open)
  }
}

// ── Action execution ──────────────────────────────────────────────────────────

async function executeAction(action: string, ctx: RuleContext, ruleId: string, ruleName: string): Promise<void> {
  const [cmd, ...rest] = action.split(':')
  const param = rest.join(':').trim()

  switch (cmd?.trim()) {
    case 'notify_supervisor': {
      // Create a visible Activity record that shows up in Audit Log / Supervisor view
      await prisma.activity.create({
        data: {
          tenantId: ctx.tenantId,
          action: 'automation.alert',
          resource: 'AutomationRule',
          resourceId: ruleId,
          metadata: {
            ruleId,
            ruleName,
            trigger: ctx.conversationStatus ?? 'event',
            conversationId: ctx.conversationId,
            csatRating: ctx.csatRating,
            messageCount: ctx.messageCount,
          },
        },
      })
      break
    }

    case 'escalate': {
      if (ctx.conversationId) {
        await prisma.conversation.updateMany({
          where: { id: ctx.conversationId, tenantId: ctx.tenantId },
          data: { status: 'escalated', outcome: 'escalated' },
        })
      }
      break
    }

    case 'resolve': {
      if (ctx.conversationId) {
        const before = await prisma.conversation.findFirst({ where: { id: ctx.conversationId, tenantId: ctx.tenantId }, select: { assignedTo: true, outcome: true } })
        await prisma.conversation.updateMany({
          where: { id: ctx.conversationId, tenantId: ctx.tenantId },
          data: { status: 'resolved', resolvedAt: new Date(), outcome: outcomeAfterStatus('resolved', before?.assignedTo ?? null, before?.outcome ?? null) },
        })
      }
      break
    }

    case 'close': {
      if (ctx.conversationId) {
        const before = await prisma.conversation.findFirst({ where: { id: ctx.conversationId, tenantId: ctx.tenantId }, select: { assignedTo: true, outcome: true } })
        await prisma.conversation.updateMany({
          where: { id: ctx.conversationId, tenantId: ctx.tenantId },
          data: { status: 'closed', outcome: outcomeAfterStatus('closed', before?.assignedTo ?? null, before?.outcome ?? null) },
        })
      }
      break
    }

    case 'add_label': {
      if (param && ctx.conversationId) {
        const label = await prisma.label.upsert({
          where: { tenantId_name: { tenantId: ctx.tenantId, name: param } },
          create: { tenantId: ctx.tenantId, name: param },
          update: {},
        })
        await prisma.conversationLabel.upsert({
          where: { conversationId_labelId: { conversationId: ctx.conversationId, labelId: label.id } },
          create: { conversationId: ctx.conversationId, labelId: label.id },
          update: {},
        })
        await prisma.activity.create({
          data: {
            tenantId: ctx.tenantId,
            action: 'automation.label_added',
            resource: 'Conversation',
            resourceId: ctx.conversationId,
            metadata: { label: param, ruleId, ruleName },
          },
        })
      }
      break
    }

    case 'send_message': {
      if (param && ctx.conversationId) {
        await prisma.message.create({
          data: {
            tenantId: ctx.tenantId,
            conversationId: ctx.conversationId,
            direction: 'outbound',
            authorKind: 'bot',
            content: { text: fillNameTokens(param, undefined) },
          },
        })
      }
      break
    }

    case 'assign_agent': {
      if (!ctx.conversationId) break
      if (param && param !== 'round_robin') {
        // Assign to a specific agent
        await prisma.conversation.updateMany({
          where: { id: ctx.conversationId, tenantId: ctx.tenantId },
          data: { assignedTo: param },
        })
      } else {
        // Round-robin: find the agent with the fewest open conversations
        const agents = await prisma.membership.findMany({
          where: { tenantId: ctx.tenantId, role: 'AGENT' },
          select: { userId: true },
        })
        if (agents.length > 0) {
          const counts = await Promise.all(
            agents.map(async (a) => ({
              userId: a.userId,
              count: await prisma.conversation.count({
                where: { tenantId: ctx.tenantId, assignedTo: a.userId, status: 'active' },
              }),
            }))
          )
          const least = counts.reduce((min, cur) => (cur.count < min.count ? cur : min), counts[0]!)
          await prisma.conversation.updateMany({
            where: { id: ctx.conversationId, tenantId: ctx.tenantId },
            data: { assignedTo: least.userId },
          })
        }
      }
      break
    }

    case 'call_webhook': {
      await dispatchWebhookEvent(ctx.tenantId, 'automation.fired', {
        ruleId,
        ruleName,
        conversationId: ctx.conversationId,
        context: ctx,
      })
      break
    }

    default:
      break
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Find all active AutomationRule records for this tenant+bot that match
 * the given trigger, evaluate their conditions, and execute their actions.
 *
 * Always resolves (never throws). Designed to be called fire-and-forget.
 */
export async function triggerRules(trigger: string, ctx: RuleContext): Promise<void> {
  try {
    const rules = await prisma.automationRule.findMany({
      where: { tenantId: ctx.tenantId, botId: ctx.botId, trigger, status: 'active' },
    })

    for (const rule of rules) {
      if (!evaluateConditions(rule.conditions, ctx)) continue

      const actions = (rule.actions as unknown as string[]) ?? []

      for (const action of actions) {
        await executeAction(action, ctx, rule.id, rule.name).catch((err) => {
          console.warn(`[automation] action "${action}" failed for rule ${rule.id}:`, err)
        })
      }

      // Bump runCount + lastRunAt
      await prisma.automationRule.update({
        where: { id: rule.id },
        data: { runCount: { increment: 1 }, lastRunAt: new Date() },
      }).catch(() => {})
    }
  } catch (err) {
    console.warn('[automation] triggerRules error:', err)
  }
}

export interface WorkflowRunResult {
  ran: boolean
  actions: string[]
  failed: string[]
}

/** Runs one workflow's actions now, skipping its trigger. Used by Workflow tools. */
export async function runWorkflowNow(ruleId: string, ctx: RuleContext): Promise<WorkflowRunResult> {
  const rule = await prisma.automationRule.findFirst({ where: { id: ruleId, tenantId: ctx.tenantId, botId: ctx.botId } })
  if (!rule) throw new Error('This workflow no longer exists. Choose another workflow on the tool.')
  if (rule.status === 'paused') return { ran: false, actions: [], failed: [] }
  const actions = (rule.actions as unknown as string[]) ?? []
  const failed: string[] = []
  for (const action of actions) {
    await executeAction(action, ctx, rule.id, rule.name).catch(() => { failed.push(action) })
  }
  await prisma.automationRule.update({
    where: { id: rule.id },
    data: { runCount: { increment: 1 }, lastRunAt: new Date() },
  }).catch(() => {})
  return { ran: true, actions, failed }
}
