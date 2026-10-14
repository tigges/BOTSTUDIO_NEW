import React, { useState } from 'react'
import { spokenLines, welcomeDoors, welcomeGreeting } from '@ybot/shared'
import type { Flow, FlowGraph } from '../../lib/api'

const DOOR_COPY: Record<string, { title: string; blurb: string }> = {
  Location: { title: 'Where we are', blurb: 'Address and how to find the studio.' },
  'Salon hours': { title: 'Hours', blurb: 'When the studio is open.' },
  'Services and prices': { title: 'Services', blurb: 'Cuts, colour, and prices.' },
  'Book an appointment': { title: 'Book', blurb: 'Been here before, what they want, a time, then a confirmation.' },
}

function doorCopy(flowName: string, description?: string): { title: string; blurb: string } {
  return DOOR_COPY[flowName] ?? { title: flowName, blurb: description?.trim() || 'Opens this chart.' }
}

export function ConversationMap({
  flows,
  persona,
  botName,
  onEdit,
}: {
  flows: Array<{ flow: Flow; graph: FlowGraph; published: boolean }>
  persona?: string | null
  botName: string
  onEdit: (flowId: string) => void
}) {
  const welcome = flows.find((item) => (
    item.flow.tags?.includes('welcome')
    || item.flow.name === 'Welcome & Routing'
    || item.flow.name === 'Product welcome'
    || item.flow.name === 'Salon welcome'
  ))
  const greeting = welcome ? welcomeGreeting(welcome.graph) : ''
  const [open, setOpen] = useState<string | null>(null)
  if (!welcome || !greeting) return null

  const voice = persona?.trim() || botName || 'this bot'
  const doors = welcomeDoors(welcome.graph).map((door) => {
    const target = flows.find((item) => item.flow.name === door.flowName)
    const steps = target ? spokenLines(target.graph) : []
    const fromSite = target?.flow.tags?.includes('website') ? steps[0] : ''
    const copy = doorCopy(door.flowName, target?.flow.description)
    return {
      flowName: door.flowName,
      flowId: target?.flow.id,
      title: copy.title,
      blurb: fromSite || copy.blurb,
      steps,
    }
  })
  const opened = doors.find((door) => door.flowName === open)

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">How {voice} talks</h2>
          <p className="text-sm text-[var(--text-muted)]">The green card is what a visitor hears first.</p>
        </div>
        <div className="max-w-md rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-[11px] font-bold text-emerald-800">
            {welcome.published ? 'Visitors start here' : 'Draft. Publish it to Sandbox when visitors should hear it.'}
          </p>
          <p className="mt-1 text-sm text-emerald-950">{greeting}</p>
        </div>
      </div>
      {doors.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {doors.map((door) => {
            const selected = open === door.flowName
            return (
              <button
                key={door.flowName}
                type="button"
                onClick={() => setOpen(selected ? null : door.flowName)}
                className={`rounded-xl border bg-[var(--bg-surface)] px-3 py-3 text-left ${
                  selected ? 'border-[var(--accent)] shadow-[0_0_0_3px_rgba(109,94,252,0.15)]' : 'border-[var(--border)]'
                }`}
              >
                <span className="block text-sm font-semibold text-[var(--text-primary)]">{door.title}</span>
                <span className="mt-1 line-clamp-3 block text-xs text-[var(--text-muted)]">{door.blurb}</span>
              </button>
            )
          })}
        </div>
      )}
      {opened && (
        <div className="mt-3 rounded-xl border border-[#d9d4ff] bg-[var(--bg-surface)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{opened.title}</p>
            {opened.flowId && (
              <button type="button" className="text-xs font-medium text-[var(--accent)]" onClick={() => onEdit(opened.flowId!)}>
                Edit chart
              </button>
            )}
          </div>
          {opened.steps.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {opened.steps.map((step, index) => (
                <div key={`${opened.flowName}-${index}`} className="rounded-lg bg-[var(--bg-base)] px-2 py-2 text-xs text-[var(--text-secondary)]">
                  <span className="mb-1 block text-[11px] text-[var(--text-muted)]">{index + 1}</span>
                  {step}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">{opened.blurb}</p>
          )}
        </div>
      )}
    </section>
  )
}
