import { inspectFlowGraph, repairFlowGraph, type CheckGraph, type CheckOptions, type FlowIssue } from '@botstudio/shared'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@botstudio/ui'

export function reviewFlow(graph: CheckGraph | null | undefined, options: CheckOptions = {}) {
  const current = graph ?? { nodes: [], edges: [] }
  const repaired = repairFlowGraph(current)
  const before = inspectFlowGraph(current, options)
  const after = inspectFlowGraph(repaired.graph, options)
  return {
    before,
    repairs: repaired.repairs,
    planned: before.filter((issue) => issue.level === 'repair'),
    blocks: after.filter((issue) => issue.level === 'block'),
    notes: after.filter((issue) => issue.level === 'note'),
    graph: repaired.graph,
  }
}

function IssueList({ title, issues }: { title: string; issues: FlowIssue[] }) {
  if (issues.length === 0) return null
  return (
    <div>
      <p className="text-xs font-medium text-[var(--text-muted)]">{title}</p>
      <ul className="mt-1 space-y-1">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.nodeId ?? index}`} className="text-sm text-[var(--text-primary)]">
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

interface PublishCheckProps {
  open: boolean
  review: ReturnType<typeof reviewFlow>
  pending: boolean
  onClose: () => void
  onRepair: () => void
  onPublish: () => void
}

export function PublishCheckDialog({ open, review, pending, onClose, onRepair, onPublish }: PublishCheckProps) {
  const canPublish = review.blocks.length === 0
  const willRepair = review.repairs.length > 0
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Check before publish</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <IssueList title="Can be repaired" issues={review.planned} />
          <IssueList title="Needs a decision" issues={review.blocks} />
          <IssueList title="Worth a look" issues={review.notes} />
          {review.repairs.length === 0 && review.blocks.length === 0 && review.notes.length === 0 && (
            <p className="text-sm text-[var(--text-secondary)]">Every step is connected. This flow can be published.</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {willRepair && (
            <Button variant="secondary" disabled={pending} onClick={onRepair}>
              Repair connections
            </Button>
          )}
          {canPublish && (
            <Button disabled={pending} onClick={onPublish}>
              {pending ? 'Publishing…' : willRepair ? 'Repair and publish' : 'Publish'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
