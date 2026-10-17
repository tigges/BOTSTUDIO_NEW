import React, { useEffect, useMemo, useState } from 'react'
import { Play, Plus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Button, PageHeader, Skeleton } from '@ybot/ui'
import { cn } from '@ybot/ui'
import {
  CATALOG_ENTITY,
  applyChatFindings,
  catalogFromValues,
  findingsFromChat,
  journeyLayout,
  journeyMarksFor,
  recommendationsForVotes,
  versionForEnvironment,
  type ChatFinding,
  type OptimizeChapter,
} from '@ybot/shared'
import type { FlowGraph as RuntimeGraph } from '@ybot/runtime'
import { FlowWizard } from './FlowWizard'
import { JourneyMap, type ChapterHealth, type JourneyLens } from './JourneyMap'
import { JourneyTest, type JourneyTestLine, type StepVote } from './JourneyTest'
import { reviewFlow } from './PublishCheck'
import { useCreateFlow, useEntities, useFlows, useJourneyTraffic, usePublishFlow, useSaveCanvas, useWorkflows } from '../../lib/hooks'
import type { Flow, FlowGraph } from '../../lib/api'
import { useAppStore } from '../../store/app'

const NO_ENVIRONMENTS: Array<{ id: string; kind: string; name: string }> = []
const LENSES: Array<{ id: JourneyLens; label: string }> = [
  { id: 'design', label: 'Design' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'health', label: 'Health' },
]

function LensTabs({ lens, onChange }: { lens: JourneyLens; onChange: (lens: JourneyLens) => void }) {
  return (
    <div className="flex gap-0 border-b border-[var(--border)] px-6">
      {LENSES.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            'relative -mb-px inline-flex h-10 items-center border-b-2 px-4 text-sm font-medium',
            lens === item.id
              ? 'border-[var(--accent)] text-[var(--text-primary)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function healthForChapter(graph: FlowGraph | undefined, names: string[]): ChapterHealth {
  if (!graph) return { label: 'No chart on this environment', detail: '' }
  const review = reviewFlow(graph, { flowNames: names })
  const open = review.blocks.length + review.repairs.length
  const first = review.blocks[0]?.message ?? review.repairs[0]?.message ?? ''
  if (open === 0) return { label: 'Clear', detail: '' }
  return { label: open === 1 ? '1 to check' : `${open} to check`, detail: first }
}

export function JourneyPage() {
  const navigate = useNavigate()
  const [lens, setLens] = useState<JourneyLens>('design')
  const [showNew, setShowNew] = useState(false)
  const [createError, setCreateError] = useState('')
  const [connectingId, setConnectingId] = useState('')
  const [connectError, setConnectError] = useState('')
  const [testing, setTesting] = useState(false)
  const [guestChapterId, setGuestChapterId] = useState('')
  const [votes, setVotes] = useState<Record<string, StepVote>>({})
  const [walkLines, setWalkLines] = useState<JourneyTestLine[]>([])
  const [queued, setQueued] = useState(false)
  const [ready, setReady] = useState<ChatFinding[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [replayKey, setReplayKey] = useState(0)
  const [replayLines, setReplayLines] = useState<string[]>([])
  const [applyingId, setApplyingId] = useState('')
  const { data: flows = [], isLoading, isError, error, refetch } = useFlows()
  const traffic = useJourneyTraffic(lens === 'traffic' || lens === 'health')
  const entities = useEntities()
  const { data: workflows = [] } = useWorkflows()
  const createFlow = useCreateFlow()
  const saveCanvas = useSaveCanvas()
  const publishFlow = usePublishFlow()
  const queryClient = useQueryClient()
  const selectedBotId = useAppStore((s) => s.selectedBotId)
  const environments = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId)?.environments) ?? NO_ENVIRONMENTS
  const selectedEnv = useAppStore((s) => s.selectedEnv)
  const environmentId = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId)?.environments.find((env) => env.kind === s.selectedEnv)?.id ?? '')
  const sandboxId = environments.find((env) => env.kind === 'sandbox')?.id ?? ''

  const shown = (flow: Flow) => versionForEnvironment(flow.versions, environmentId, selectedEnv)
  const named = useMemo(() => flows.flatMap((flow) => {
    const version = shown(flow)
    if (!version) return []
    return [{
      id: flow.id,
      name: flow.name,
      tags: flow.tags,
      published: version.status === 'published',
      graph: version.graph,
    }]
  }), [flows, environmentId, selectedEnv])
  const catalog = useMemo(() => {
    const row = entities.data?.find((entity) => entity.name === CATALOG_ENTITY)
    return catalogFromValues(row?.values)
  }, [entities.data])
  const layout = useMemo(() => journeyLayout(named), [named])
  const suggestedIds = useMemo(() => new Set(layout.suggested.map((chapter) => chapter.id)), [layout])
  const guestChapters = useMemo(() => named.flatMap((flow) => {
    if (!flow.graph || suggestedIds.has(flow.id)) return []
    return [{ name: flow.name, graph: flow.graph as unknown as RuntimeGraph }]
  }), [named, suggestedIds])
  const welcome = layout.roots.find((chapter) => chapter.welcome)
  const environmentLabel = selectedEnv === 'production' ? 'Production' : 'Sandbox'
  const selectedBot = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId))
  const botName = selectedBot?.personaName?.trim() || selectedBot?.name || 'Bot'
  const chapterKey = guestChapters.map((chapter) => chapter.name).join('|')
  const names = flows.map((flow) => flow.name)
  const graphs = useMemo(() => {
    const map = new Map<string, FlowGraph | undefined>()
    for (const flow of named) map.set(flow.id, flow.graph)
    return map
  }, [named])
  const optimizeChapters = useMemo(
    () => guestChapters as unknown as OptimizeChapter[],
    [guestChapters],
  )
  const marks = useMemo(() => journeyMarksFor(ready), [ready])

  useEffect(() => {
    setVotes({})
    setWalkLines([])
    setReady([])
    setQueued(false)
    setDismissed(new Set())
    setReplayLines([])
  }, [selectedBotId, environmentLabel])

  useEffect(() => {
    if (!queued) return
    const timer = window.setTimeout(() => {
      const findings = recommendationsForVotes({
        findings: findingsFromChat({ lines: walkLines, chapters: optimizeChapters }),
        votes,
      }).filter((finding) => !dismissed.has(finding.id))
      setReady(findings)
      setQueued(false)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [queued, walkLines, optimizeChapters, votes, dismissed])

  function searchFor(flowId: string) {
    const flow = named.find((item) => item.id === flowId)
    const finding = ready.find((item) => (
      item.fromChapter === flow?.name
      || item.openedChapter === flow?.name
      || item.shouldOpen === flow?.name
      || item.chapterName === flow?.name
    ))
    return { from: 'journey' as const, mark: finding?.kind }
  }

  async function acceptFinding(finding: ChatFinding) {
    if (!finding.applyable) return
    setApplyingId(finding.id)
    try {
      const applied = applyChatFindings({ chapters: optimizeChapters, findings: [finding] })
      for (const change of applied.chapters) {
        const flow = flows.find((item) => item.name === change.name)
        const version = flow ? shown(flow) : undefined
        const before = optimizeChapters.find((item) => item.name === change.name)
        if (!flow || !version || JSON.stringify(before?.graph) === JSON.stringify(change.graph)) continue
        await saveCanvas.mutateAsync({
          flowId: flow.id,
          version: version.version,
          graph: change.graph as FlowGraph,
        })
      }
      if (selectedBotId) await queryClient.invalidateQueries({ queryKey: ['flows', selectedBotId] })
      setReady((current) => current.filter((item) => item.id !== finding.id))
      setDismissed((current) => new Set([...current, finding.id]))
      setReplayLines(walkLines.filter((line) => line.role === 'user').map((line) => line.content))
      setReplayKey((key) => key + 1)
    } finally {
      setApplyingId('')
    }
  }

  function rejectFinding(finding: ChatFinding) {
    setReady((current) => current.filter((item) => item.id !== finding.id))
    setDismissed((current) => new Set([...current, finding.id]))
  }

  function automationsFor(chapterName: string): string[] {
    const needle = chapterName.toLowerCase()
    return workflows.flatMap((workflow) => {
      const blob = `${workflow.name} ${workflow.description ?? ''} ${workflow.conditions ?? ''}`.toLowerCase()
      if (blob.includes(needle) && needle.length >= 4) return [workflow.name]
      if (/book/i.test(chapterName) && /phorest|fresha|booksy|calendly|vagaro/i.test(workflow.name)) {
        return [workflow.name]
      }
      return []
    })
  }

  async function handleCreate(input: { name: string; description: string; tags: string[]; graph: FlowGraph }) {
    setCreateError('')
    try {
      const flow = await createFlow.mutateAsync({
        name: input.name,
        description: input.description || undefined,
        tags: input.tags,
        graph: input.graph,
      })
      await saveCanvas.mutateAsync({ flowId: flow.id, version: flow.versions?.[0]?.version ?? 1, graph: input.graph })
      setShowNew(false)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create this chapter.')
    }
  }

  async function connect(flowId: string) {
    if (!sandboxId) {
      setConnectError('This bot has no Sandbox yet.')
      return
    }
    setConnectError('')
    setConnectingId(flowId)
    try {
      const flow = flows.find((item) => item.id === flowId)
      const draft = flow?.versions?.find((version) => version.status !== 'published')
      await publishFlow.mutateAsync({ flowId, environmentId: sandboxId, version: draft?.version })
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Could not connect this chapter.')
    } finally {
      setConnectingId('')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Journey"
        description="Each chart is a chapter. Click a chart to edit it."
        actions={
          <>
            {lens === 'design' && (
              <Button
                size="md"
                variant={testing ? 'secondary' : 'ghost'}
                disabled={!welcome && !testing}
                onClick={() => {
                  setTesting((open) => !open)
                  if (testing) setGuestChapterId('')
                }}
              >
                <Play size={14} /> {testing ? 'Hide test' : 'Test this journey'}
              </Button>
            )}
            <Button size="md" onClick={() => setShowNew(true)}>
              <Plus size={14} /> Add chapter
            </Button>
          </>
        }
        tabs={<LensTabs lens={lens} onChange={setLens} />}
      />
      <div className="flex min-h-0 flex-1">
      <div className="flex-1 overflow-auto p-6">
        {lens === 'traffic' && traffic.isError && (
          <p className="mb-4 text-sm text-[var(--text-secondary)]">Traffic counts are unavailable right now. The chapters are still here.</p>
        )}
        {connectError && <p className="mb-4 text-sm text-[var(--danger)]">{connectError}</p>}
        {queued && (
          <p className="mb-4 text-sm text-[var(--text-secondary)]" data-testid="journey-recommend-queued">
            Looking at this step…
          </p>
        )}
        {ready.length > 0 && (
          <div className="mb-4 space-y-3" data-testid="journey-recommend">
            {ready.map((finding) => (
              <div
                key={finding.id}
                className={cn(
                  'rounded-xl border px-4 py-3',
                  finding.shouldOpen ? 'border-[var(--accent)] bg-[var(--accent-muted)]' : 'border-[var(--border-strong)] bg-[var(--bg-surface)]',
                )}
              >
                <p className="text-sm font-semibold text-[var(--text-primary)]">{finding.title}</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{finding.detail}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {finding.applyable && (
                    <Button
                      size="sm"
                      disabled={applyingId === finding.id}
                      data-testid="journey-recommend-accept"
                      onClick={() => { void acceptFinding(finding) }}
                    >
                      {applyingId === finding.id ? 'Saving…' : 'Accept'}
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => rejectFinding(finding)}>
                    Reject
                  </Button>
                  {named.some((item) => item.name === finding.fromChapter || item.name === finding.chapterName) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const flow = named.find((item) => item.name === finding.fromChapter || item.name === finding.chapterName)
                        if (!flow) return
                        navigate({ to: '/build/flows/$flowId', params: { flowId: flow.id }, search: { from: 'journey', mark: finding.kind } })
                      }}
                    >
                      Open chart
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-24 w-full rounded-xl" />)}</div>
        ) : isError ? (
          <div>
            <p className="text-sm text-[var(--text-secondary)]">{error instanceof Error ? error.message : 'Could not load the chapters.'}</p>
            <Button className="mt-3" size="md" variant="secondary" onClick={() => { void refetch() }}>Try again</Button>
          </div>
        ) : (
          <JourneyMap
            layout={layout}
            lens={lens}
            chats={traffic.data?.chats ?? {}}
            healthFor={(id) => (lens === 'health' ? healthForChapter(graphs.get(id), names) : undefined)}
            automationsFor={automationsFor}
            connectingId={connectingId}
            activeId={lens === 'design' && testing ? guestChapterId : undefined}
            marks={marks}
            onOpen={(flowId) => navigate({ to: '/build/flows/$flowId', params: { flowId }, search: searchFor(flowId) })}
            onConnect={(flowId) => { void connect(flowId) }}
          />
        )}
      </div>
      {lens === 'design' && testing && welcome && (
        <JourneyTest
          botName={botName}
          avatarUrl={selectedBot?.avatarUrl}
          chapters={guestChapters}
          startChapter={welcome.name}
          environmentLabel={environmentLabel}
          chapterKey={chapterKey}
          catalog={catalog}
          votes={votes}
          replayKey={replayKey}
          replayLines={replayLines}
          onChapter={(name) => {
            const match = named.find((flow) => flow.name === name)
            setGuestChapterId(match?.id ?? '')
          }}
          onVote={({ chapter, vote, lines }) => {
            setVotes((current) => ({ ...current, [chapter]: vote }))
            setWalkLines(lines)
            if (vote === 'down') {
              setDismissed(new Set())
              setQueued(true)
            } else {
              setReady((current) => current.filter((finding) => {
                const names = [finding.openedChapter, finding.fromChapter, finding.chapterName, finding.shouldOpen]
                return !names.includes(chapter)
              }))
            }
          }}
          onClose={() => { setTesting(false); setGuestChapterId('') }}
        />
      )}
      </div>
      <FlowWizard
        open={showNew}
        existingNames={flows.map((flow) => flow.name)}
        pending={createFlow.isPending || saveCanvas.isPending}
        error={createError}
        onClose={() => { setShowNew(false); setCreateError('') }}
        onCreate={(input) => { void handleCreate(input) }}
      />
    </div>
  )
}
