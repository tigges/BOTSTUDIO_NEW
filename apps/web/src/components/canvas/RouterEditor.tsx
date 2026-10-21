import React, { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  FALLBACK_ROUTE,
  GUARD_OPERATORS,
  GUARD_OPERATOR_LABELS,
  routeDecision,
  routerRoutes,
  type RouterRoute,
} from '@botstudio/shared'

type RawRoute = Record<string, unknown>

interface RouterEditorProps {
  config: Record<string, unknown> | undefined
  onChange: (routes: RawRoute[]) => void
}

const fieldClass =
  'w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none'

/** A text field that saves when you leave it, so commas and half-typed words survive. */
function DraftField({ value, onCommit, placeholder, label, multiline }: {
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  label: string
  multiline?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const commit = () => { if (draft !== value) onCommit(draft) }
  const props = {
    'aria-label': label,
    placeholder,
    value: draft,
    onBlur: commit,
    className: `${fieldClass}${multiline ? ' resize-none' : ''}`,
  }
  return multiline
    ? <textarea rows={2} {...props} onChange={(e) => setDraft(e.target.value)} />
    : <input {...props} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} />
}

function rawRoutes(config: Record<string, unknown> | undefined): RawRoute[] {
  const raw = config?.['routes']
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is RawRoute => {
    if (!item || typeof item !== 'object') return false
    const handle = String((item as RawRoute)['handle'] ?? '').trim()
    return Boolean(handle) && handle !== FALLBACK_ROUTE
  })
}

function newHandle(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'route'
  let handle = base
  for (let n = 2; taken.includes(handle) || handle === FALLBACK_ROUTE; n += 1) handle = `${base}-${n}`
  return handle
}

function Decision({ route }: { route: RouterRoute }) {
  const { rules, model } = routeDecision(route)
  return (
    <div className="space-y-0.5 text-[10px]">
      <p className="text-[var(--text-secondary)]">
        <span className="font-medium">Rules:</span> {rules.length ? rules.join(' · ') : 'none'}
      </p>
      <p className="text-[var(--text-secondary)]">
        <span className="font-medium">Model reads:</span> {model || 'nothing, the rule alone decides'}
      </p>
    </div>
  )
}

export function RouterEditor({ config, onChange }: RouterEditorProps) {
  const raw = rawRoutes(config)
  const routes = routerRoutes({ routes: raw })

  const update = (index: number, patch: RawRoute) => {
    onChange(raw.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }
  const move = (index: number, by: number) => {
    const next = raw.slice()
    const [item] = next.splice(index, 1)
    if (item) next.splice(index + by, 0, item)
    onChange(next)
  }
  const remove = (index: number) => onChange(raw.filter((_, i) => i !== index))
  const add = () => {
    const handle = newHandle(`route ${raw.length + 1}`, raw.map((item) => String(item['handle'] ?? '')))
    onChange([...raw, { handle, label: `Route ${raw.length + 1}`, intent: '', phrases: [] }])
  }

  return (
    <div className="flex flex-col gap-3" data-testid="router-editor">
      <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
        Routes are tried in this order. Rules decide first: a route with only a rule, then the words.
        The model picks only when no rule did, and only among routes whose rule lets the chat through.
      </p>

      {routes.map((route, index) => {
        const item = raw[index] ?? {}
        const guard = route.guard
        const needsValue = guard ? !['is_set', 'is_empty'].includes(guard.operator) : false
        return (
          <div key={route.handle} className="space-y-2 rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2" data-route={route.handle}>
            <div className="flex items-center gap-1">
              <span className="w-4 text-[10px] font-semibold text-[var(--text-muted)]">{index + 1}</span>
              <div className="flex-1">
                <DraftField label={`Route ${index + 1} name`} value={route.label} onCommit={(label) => update(index, { label: label.trim() || route.handle })} />
              </div>
              <button type="button" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)} className="p-1 text-[var(--text-muted)] disabled:opacity-30 hover:text-[var(--text-primary)]"><ArrowUp size={12} /></button>
              <button type="button" title="Move down" aria-label="Move down" disabled={index === routes.length - 1} onClick={() => move(index, 1)} className="p-1 text-[var(--text-muted)] disabled:opacity-30 hover:text-[var(--text-primary)]"><ArrowDown size={12} /></button>
              <button type="button" title="Remove route" aria-label="Remove route" onClick={() => remove(index)} className="p-1 text-[var(--text-muted)] hover:text-[var(--error)]"><Trash2 size={12} /></button>
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-medium text-[var(--text-secondary)]">What the guest means <span className="font-normal text-[var(--text-muted)]">· the model reads this</span></p>
              <DraftField
                label={`Route ${index + 1} intent`}
                multiline
                value={route.intent}
                placeholder="The guest wants to book an appointment"
                onCommit={(intent) => update(index, { intent: intent.trim() })}
              />
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-medium text-[var(--text-secondary)]">Words <span className="font-normal text-[var(--text-muted)]">· a rule, no model</span></p>
              <DraftField
                label={`Route ${index + 1} words`}
                value={route.phrases.join(', ')}
                placeholder="book, appointment"
                onCommit={(text) => update(index, { phrases: text.split(',').map((phrase) => phrase.trim()).filter(Boolean) })}
              />
            </div>

            {guard ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-medium text-[var(--text-secondary)]">Only when <span className="font-normal text-[var(--text-muted)]">· a rule, no model</span></p>
                  <button type="button" className="text-[10px] text-[var(--text-muted)] hover:text-[var(--error)]" onClick={() => {
                    const { guard: _drop, ...rest } = item
                    onChange(raw.map((entry, i) => (i === index ? rest : entry)))
                  }}>Remove rule</button>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-1">
                  <DraftField label={`Route ${index + 1} rule value name`} value={guard.field} placeholder="tier" onCommit={(field) => update(index, { guard: { ...guard, field: field.trim() } })} />
                  <select
                    aria-label={`Route ${index + 1} rule check`}
                    value={guard.operator}
                    onChange={(e) => update(index, { guard: { ...guard, operator: e.target.value } })}
                    className={fieldClass}
                  >
                    {!GUARD_OPERATORS.includes(guard.operator as never) && <option value={guard.operator}>{guard.operator} (not allowed)</option>}
                    {GUARD_OPERATORS.map((operator) => <option key={operator} value={operator}>{GUARD_OPERATOR_LABELS[operator]}</option>)}
                  </select>
                </div>
                {needsValue && (
                  <DraftField label={`Route ${index + 1} rule compare with`} value={guard.value} placeholder="gold" onCommit={(value) => update(index, { guard: { ...guard, value: value.trim() } })} />
                )}
              </div>
            ) : (
              <button type="button" className="text-[10px] font-medium text-[var(--accent)] hover:underline" onClick={() => update(index, { guard: { field: '', operator: 'equals', value: '' } })}>
                + Only when… (add a rule)
              </button>
            )}

            <Decision route={route} />
          </div>
        )
      })}

      <div className="space-y-1 rounded border border-dashed border-[var(--border)] p-2" data-route="other">
        <p className="text-xs font-medium text-[var(--text-primary)]">Fallback · Other</p>
        <p className="text-[10px] text-[var(--text-muted)]">Takes anything no route takes. Every Router needs it: connect the Other line to a step before you publish.</p>
      </div>

      <button type="button" onClick={add} className="flex items-center justify-center gap-1 rounded border border-[var(--border)] py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--border-focus)] hover:text-[var(--text-primary)]">
        <Plus size={12} /> Add a route
      </button>
    </div>
  )
}
