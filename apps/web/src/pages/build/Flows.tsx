import React, { useState } from 'react'
import { Workflow, Plus, Search, Play, Trash2, Pencil } from 'lucide-react'
import { Button, Input, Badge, Table, THead, TBody, TR, TH, TD, EmptyState, PageHeader, Skeleton, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@ybot/ui'
import { useNavigate } from '@tanstack/react-router'
import { useFlows, useCreateFlow, useDeleteFlow, useUpdateFlow, useSaveCanvas, useImportStarterPack, useRemoveStarterPack } from '../../lib/hooks'
import type { CorporatePackResult, PackRemovalResult } from '../../lib/api'
import { FlowWizard } from './FlowWizard'
import { LearnFromChats } from './LearnFromChats'
import { reviewFlow } from './PublishCheck'
import type { Flow, FlowGraph } from '../../lib/api'
import { useAppStore } from '../../store/app'
import { versionForEnvironment } from '@ybot/shared'

const NO_ENVIRONMENTS: Array<{ id: string; kind: string; name: string }> = []

function PackResult({ result, pack }: { result: CorporatePackResult; pack: 'corporate-services' | 'hair-studio' }) {
  const added = result.flowsAdded.length + result.intentsAdded + result.faqsAdded
  const label = pack === 'hair-studio' ? 'hair studio' : 'corporate services'
  const draftName = pack === 'hair-studio' ? 'Salon welcome' : 'Corporate welcome'
  if (added === 0) {
    return <p className="text-sm text-[var(--text-secondary)]">This bot already has the {label} pack.</p>
  }
  const draft = result.draftNames.includes(draftName)
  return (
    <div className="space-y-2 text-sm text-[var(--text-secondary)]">
      <p>Added {result.flowsAdded.length} flows, {result.intentsAdded} intents, and {result.faqsAdded} FAQs.</p>
      {result.publishedNames.length > 0 && result.environmentName && (
        <p>The new answers are published on {result.environmentName}.</p>
      )}
      {draft && (
        <p>{draftName} is a draft on this list. Publish it in Sandbox when you want the widget to use that greeting.</p>
      )}
    </div>
  )
}

export function FlowsPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [createError, setCreateError] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string; description: string } | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const [showPack, setShowPack] = useState(false)
  const [packChoice, setPackChoice] = useState<'corporate-services' | 'hair-studio' | null>(null)
  const [packResult, setPackResult] = useState<CorporatePackResult | null>(null)
  const [packRemoved, setPackRemoved] = useState<PackRemovalResult | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [packError, setPackError] = useState('')

  const { data: flows = [], isLoading, isError, error, refetch } = useFlows()
  const createFlow = useCreateFlow()
  const saveCanvas = useSaveCanvas()
  const updateFlow = useUpdateFlow()
  const deleteFlow = useDeleteFlow()
  const importPack = useImportStarterPack()
  const removePack = useRemoveStarterPack()
  const environments = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId)?.environments) ?? NO_ENVIRONMENTS
  const botName = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId)?.name ?? '')
  const selectedEnv = useAppStore((s) => s.selectedEnv)
  const setEnv = useAppStore((s) => s.setEnv)
  const environmentId = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBotId)?.environments.find((env) => env.kind === s.selectedEnv)?.id ?? '')
  const envLabel = selectedEnv === 'production' ? 'Production' : 'Sandbox'
  const shown = (flow: Flow) => versionForEnvironment(flow.versions, environmentId, selectedEnv)

  const flowNames = flows.map((flow) => flow.name)
  const checked = flows.flatMap((flow) => {
    const latest = shown(flow)
    if (!latest?.graph) return []
    const review = reviewFlow(latest.graph, { flowNames })
    const open = review.repairs.length + review.blocks.length + review.notes.length
    if (open === 0) return []
    return [{ flow, version: latest.version, review }]
  })
  const filtered = flows.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))

  async function repairStored(flowId: string, version: number, graph: { nodes: unknown[]; edges: unknown[] }) {
    await saveCanvas.mutateAsync({
      flowId,
      version,
      graph: graph as FlowGraph,
    })
  }

  function relativeTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60_000)
    if (m < 2) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
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
      if (environments.some((env) => env.kind === 'sandbox')) setEnv('sandbox')
      setShowNew(false)
      navigate({ to: '/build/flows/$flowId', params: { flowId: flow.id }, search: { from: undefined } })
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create this flow.')
    }
  }

  async function saveRename() {
    if (!renaming?.name.trim()) return
    await updateFlow.mutateAsync({
      flowId: renaming.id,
      name: renaming.name.trim(),
      description: renaming.description.trim(),
    })
    setRenaming(null)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Flows"
        description="Each flow is one chapter. Publish, rename, and repair them here."
        actions={
          <div className="flex items-center gap-2">
            <Button size="md" variant="secondary" onClick={() => { setPackChoice(null); setPackResult(null); setPackRemoved(null); setConfirmRemove(false); setPackError(''); setShowPack(true) }}>
              Starter packs
            </Button>
            <Button size="md" onClick={() => setShowNew(true)}>
              <Plus size={14} /> New Flow
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        <LearnFromChats
          botName={botName}
          envLabel={envLabel}
          environmentId={environmentId}
          sandboxId={environments.find((env) => env.kind === 'sandbox')?.id ?? ''}
        />
        {checked.length > 0 && (
          <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
            <p className="text-sm font-medium text-[var(--text-primary)]">Connection check</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              This check uses the {envLabel} version. A published flow with a missing line does not run that path. Repair fills the lines that have an obvious fix. The rest need a decision, then a walk-through in Test Bot.
            </p>
            <div className="mt-3 flex flex-col gap-3">
              {checked.map(({ flow, version, review }) => (
                <div key={flow.id} className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{flow.name}</p>
                    {review.repairs.length > 0 && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={saveCanvas.isPending}
                        onClick={() => { void repairStored(flow.id, version, review.graph) }}
                      >
                        Repair connections
                      </Button>
                    )}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {[...review.planned, ...review.blocks, ...review.notes].map((issue, index) => (
                      <li key={`${issue.code}-${index}`} className="text-xs text-[var(--text-secondary)]">{issue.message}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 flex items-center gap-3">
          <div className="flex-1 max-w-xs">
            <Input
              placeholder="Search flows…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              leftIcon={<Search size={14} />}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-[var(--radius-md)]" />)}</div>
        ) : isError ? (
          <EmptyState
            icon={<Workflow size={20} />}
            title="Could not load flows"
            description={error instanceof Error ? error.message : 'The server is not responding. Try again in a moment.'}
            action={<Button size="md" variant="secondary" onClick={() => { void refetch() }}>Try again</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Workflow size={20} />}
            title="No flows yet"
            description="Create your first flow to start building conversations."
            action={<Button size="md" onClick={() => setShowNew(true)}><Plus size={14} /> New Flow</Button>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Status</TH>
                <TH>Version</TH>
                <TH>Updated</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {filtered.map((flow) => {
                const latest = shown(flow)
                return (
                  <TR key={flow.id} onClick={() => navigate({ to: '/build/flows/$flowId', params: { flowId: flow.id }, search: { from: undefined } })}>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Workflow size={14} className="text-[var(--text-muted)]" />
                        <div>
                          <span className="font-medium">{flow.name}</span>
                          {flow.description && <p className="text-xs text-[var(--text-muted)]">{flow.description}</p>}
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <Badge variant={latest?.status === 'published' ? 'success' : 'muted'} dot>
                        {latest?.status ?? 'Not published'}
                      </Badge>
                    </TD>
                    <TD className="text-[var(--text-muted)]">{latest ? `v${latest.version}` : '—'}</TD>
                    <TD className="text-[var(--text-muted)]">{relativeTime(flow.updatedAt)}</TD>
                    <TD>
                      <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon-sm" title="Rename" onClick={() => setRenaming({ id: flow.id, name: flow.name, description: flow.description ?? '' })}><Pencil size={12} /></Button>
                        <Button variant="ghost" size="icon-sm" title="Open canvas" onClick={() => navigate({ to: '/build/flows/$flowId', params: { flowId: flow.id }, search: { from: undefined } })}><Play size={12} /></Button>
                        <Button variant="ghost" size="icon-sm" title="Delete" onClick={() => setDeleting({ id: flow.id, name: flow.name })}><Trash2 size={12} /></Button>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>

      <Dialog open={showPack} onOpenChange={(open) => { if (!open) setShowPack(false) }}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{packChoice === 'hair-studio' ? 'Hair studio' : packChoice === 'corporate-services' ? 'Corporate services' : 'Starter packs'}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {packRemoved && packChoice ? (
              <p className="text-sm text-[var(--text-secondary)]">
                Removed {packRemoved.flowsRemoved.length} flows, {packRemoved.intentsRemoved} intents, and {packRemoved.faqsRemoved} FAQs from the {packChoice === 'hair-studio' ? 'hair studio' : 'corporate services'} pack. Flows that were already on this bot stay.
              </p>
            ) : packResult && packChoice ? (
              <PackResult result={packResult} pack={packChoice} />
            ) : confirmRemove && packChoice ? (
              <>
                <p className="text-sm text-[var(--text-secondary)]">
                  Remove the {packChoice === 'hair-studio' ? 'hair studio' : 'corporate services'} pack from this bot? The flows, intents, and FAQs it added are deleted. Flows that were already here stay, including the welcome the widget is using.
                </p>
                {packError && <p className="text-xs text-[var(--danger)]">{packError}</p>}
              </>
            ) : packChoice === null ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setPackChoice('corporate-services')} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-left hover:bg-[var(--bg-hover)]">
                  <p className="text-sm font-medium text-[var(--text-primary)]">Corporate services</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Hours, shipping, returns, tracking, payments, passwords, and plans.</p>
                </button>
                <button type="button" onClick={() => setPackChoice('hair-studio')} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-left hover:bg-[var(--bg-hover)]">
                  <p className="text-sm font-medium text-[var(--text-primary)]">Hair studio</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Bookings, prices, vouchers, and the salon address. The menu matches Bella.</p>
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-[var(--text-secondary)]">
                  {packChoice === 'hair-studio'
                    ? 'This pack greets a guest and answers the questions a salon hears first: a booking, a new time, a cancellation, prices, a voucher, opening hours, walk-ins, the address, and a person at the studio. It also covers a free consultation, colour correction, a patch test, running late, and choosing a stylist. Cuts from £35 and 14 Rosewood Lane match the Bella demo page. Edit those lines for your own salon. A booking notes the service and the day. The studio confirms the time in the chat.'
                    : 'This pack greets the visitor and answers the questions customers ask first: hours, shipping, returns, tracking, payments, passwords, plans, and reaching a person. The wording is a benchmark. Edit each message so it matches your business. The guided wizard is how you reshape a flow after that.'}
                </p>
                <p className="text-sm text-[var(--text-secondary)]">
                  The widget says the words in the published flow. The same answers are added under Intents and FAQs. Anything already on this bot stays as it is. Your current welcome stays the one the widget uses. A draft named {packChoice === 'hair-studio' ? 'Salon welcome' : 'Corporate welcome'} is added when you already have a welcome. Publish that draft in Sandbox when you want to try the new greeting. Publish a flow to Production when the live widget should use it.
                </p>
                {packError && <p className="text-xs text-[var(--danger)]">{packError}</p>}
              </>
            )}
          </DialogBody>
          <DialogFooter>
            {packChoice && !packResult && !packRemoved ? (
              <Button variant="ghost" onClick={() => { if (confirmRemove) { setConfirmRemove(false); setPackError('') } else { setPackChoice(null); setPackError('') } }}>Back</Button>
            ) : (
              <Button variant="ghost" onClick={() => setShowPack(false)}>{packResult || packRemoved ? 'Close' : 'Cancel'}</Button>
            )}
            {packChoice && !packResult && !packRemoved && !confirmRemove && (
              <Button
                variant="destructive"
                disabled={removePack.isPending}
                onClick={() => { setPackError(''); setConfirmRemove(true) }}
              >
                Remove pack
              </Button>
            )}
            {packChoice && confirmRemove && !packRemoved && (
              <Button
                variant="destructive"
                disabled={removePack.isPending}
                onClick={() => {
                  setPackError('')
                  removePack.mutate(packChoice, {
                    onSuccess: (result) => { setPackRemoved(result); setConfirmRemove(false) },
                    onError: (err) => setPackError(err instanceof Error ? err.message : 'Could not remove the pack.'),
                  })
                }}
              >
                {removePack.isPending ? 'Removing…' : 'Remove pack'}
              </Button>
            )}
            {packChoice && !packResult && !packRemoved && !confirmRemove && (
              <Button
                disabled={importPack.isPending}
                onClick={() => {
                  setPackError('')
                  importPack.mutate(packChoice, {
                    onSuccess: (result) => setPackResult(result),
                    onError: (err) => setPackError(err instanceof Error ? err.message : 'Could not import the pack.'),
                  })
                }}
              >
                {importPack.isPending ? 'Importing…' : 'Import pack'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FlowWizard
        open={showNew}
        existingNames={flows.map((flow) => flow.name)}
        pending={createFlow.isPending || saveCanvas.isPending}
        error={createError}
        onClose={() => { setShowNew(false); setCreateError('') }}
        onCreate={(input) => { void handleCreate(input) }}
      />

      <Dialog open={!!renaming} onOpenChange={(open) => { if (!open) setRenaming(null) }}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Rename flow</DialogTitle></DialogHeader>
          <DialogBody className="space-y-3">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Name *</label>
              <Input autoFocus value={renaming?.name ?? ''} onChange={(e) => setRenaming((current) => current ? { ...current, name: e.target.value } : current)} onKeyDown={(e) => e.key === 'Enter' && void saveRename()} />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Description</label>
              <Input value={renaming?.description ?? ''} onChange={(e) => setRenaming((current) => current ? { ...current, description: e.target.value } : current)} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button disabled={!renaming?.name.trim() || updateFlow.isPending} onClick={() => void saveRename()}>
              {updateFlow.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Delete flow</DialogTitle></DialogHeader>
          <DialogBody>
            <p className="text-sm text-[var(--text-secondary)]">Delete {deleting?.name}? The canvas for this flow is removed.</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              disabled={deleteFlow.isPending}
              onClick={() => {
                if (!deleting) return
                deleteFlow.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
              }}
            >
              {deleteFlow.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
