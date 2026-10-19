import React, { useState } from 'react'
import { Wrench, X } from 'lucide-react'
import { Button } from '@ybot/ui'
import { TOOL_EFFECT_LABELS, toolChangesData } from '@ybot/shared'
import { useInboxTools, useRunInboxTool } from '../../lib/hooks'
import type { InboxTool } from '../../lib/api'

interface RunToolPanelProps {
  conversationId: string
  onClose: () => void
}

const inputClass = 'w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none'

export function RunToolPanel({ conversationId, onClose }: RunToolPanelProps) {
  const { data: tools, isLoading, isError, refetch } = useInboxTools(conversationId)
  const [toolId, setToolId] = useState('')
  const tool = (tools ?? []).find((item) => item.id === toolId)

  return (
    <div className="mx-4 mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-lg)]" data-testid="inbox-run-tool">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]"><Wrench size={12} /> Run a tool</p>
        <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close"><X size={13} /></button>
      </div>
      {isLoading ? (
        <p className="text-xs text-[var(--text-muted)]">Loading tools…</p>
      ) : isError ? (
        <p className="text-xs text-[var(--error)]">The tools did not load. <button type="button" className="underline" onClick={() => void refetch()}>Try again</button></p>
      ) : (tools ?? []).length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">This bot has no tools yet. A builder can add them under Build → Tools.</p>
      ) : (
        <>
          <select aria-label="Tool" value={toolId} onChange={(e) => setToolId(e.target.value)} className={inputClass}>
            <option value="">Choose a tool</option>
            {(tools ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {tool && <ToolForm key={tool.id} conversationId={conversationId} tool={tool} onDone={onClose} />}
        </>
      )}
    </div>
  )
}

function ToolForm({ conversationId, tool, onDone }: { conversationId: string; tool: InboxTool; onDone: () => void }) {
  const run = useRunInboxTool()
  const [args, setArgs] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const changesData = toolChangesData(tool.effect)
  const missing = tool.parameters.filter((param) => param.required && !String(args[param.name] ?? '').trim()).map((param) => param.name)

  async function submit() {
    const body: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(args)) if (value.trim()) body[name] = value
    try {
      const result = await run.mutateAsync({ conversationId, toolId: tool.id, args: body, confirmed })
      if (result.ok) onDone()
    } catch { /* shown below */ }
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[11px] text-[var(--text-muted)]">{tool.description} · {TOOL_EFFECT_LABELS[tool.effect]}</p>
      {tool.parameters.map((param) => (
        <div key={param.name} className="flex flex-col gap-1">
          <label htmlFor={`inbox-arg-${param.name}`} className="text-[11px] text-[var(--text-secondary)]">
            {param.name}{param.required ? ' *' : ''} <span className="text-[var(--text-muted)]">({param.type})</span>
          </label>
          {param.enum?.length ? (
            <select id={`inbox-arg-${param.name}`} className={inputClass} value={args[param.name] ?? ''} onChange={(e) => setArgs({ ...args, [param.name]: e.target.value })}>
              <option value="">Choose</option>
              {param.enum.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : (
            <input id={`inbox-arg-${param.name}`} className={inputClass} placeholder={param.description} value={args[param.name] ?? ''} onChange={(e) => setArgs({ ...args, [param.name]: e.target.value })} />
          )}
        </div>
      ))}
      {changesData && (
        <label className="flex items-start gap-2 text-[11px] text-[var(--text-secondary)]">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          <span>{tool.name} changes data outside BotStudio. I want to run it for this guest.</span>
        </label>
      )}
      {run.data && !run.data.ok && <p className="text-[11px] text-[var(--error)]">{tool.name} failed: {run.data.error}</p>}
      {run.error && <p className="text-[11px] text-[var(--error)]">{run.error.message}</p>}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--text-muted)]">The result is saved as an internal note. The guest does not see it.</span>
        <Button size="sm" onClick={() => void submit()} disabled={run.isPending || missing.length > 0 || (changesData && !confirmed)} title={missing.length ? `Fill in ${missing.join(', ')}` : undefined}>
          {run.isPending ? 'Running…' : 'Run'}
        </Button>
      </div>
    </div>
  )
}
