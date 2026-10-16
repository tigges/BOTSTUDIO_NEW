import React from 'react'
import { Link } from '@tanstack/react-router'
import type { JourneyChapter, JourneyLayout } from '@ybot/shared'
import { Button } from '@ybot/ui'

export type JourneyLens = 'design' | 'traffic' | 'health'

export interface ChapterHealth {
  label: string
  detail: string
}

function clip(text: string, max = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function Chart({
  chapter,
  lens,
  chats,
  health,
  automations,
  connecting,
  active,
  onOpen,
  onConnect,
}: {
  chapter: JourneyChapter
  lens: JourneyLens
  chats: number | undefined
  health: ChapterHealth | undefined
  automations: string[]
  connecting: boolean
  active: boolean
  onOpen: (id: string) => void
  onConnect: (id: string) => void
}) {
  const loose = !chapter.welcome && !chapter.suggested && chapter.children.length === 0
  return (
    <div
      className={[
        'rounded-xl border bg-[var(--bg-surface)] px-3 py-3',
        chapter.welcome ? 'border-emerald-200 bg-emerald-50' : '',
        chapter.suggested ? 'border-dashed border-amber-300 bg-amber-50' : '',
        !chapter.welcome && !chapter.suggested ? 'border-[var(--border)]' : '',
        loose && !chapter.published ? 'border-dashed' : '',
        active ? 'ring-2 ring-[var(--accent)]' : '',
      ].join(' ')}
      data-chapter={chapter.name}
      data-active={active ? 'true' : 'false'}
    >
      <button type="button" className="block w-full text-left" onClick={() => onOpen(chapter.id)}>
        <span className={`block text-sm font-semibold ${chapter.welcome ? 'text-emerald-800' : 'text-[var(--text-primary)]'}`}>
          {chapter.name}
        </span>
        {lens === 'design' && (
          <span className="mt-2 flex flex-wrap items-center gap-1">
            {!chapter.published && !chapter.suggested && (
              <span className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-base)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
                Draft
              </span>
            )}
            {chapter.looksUp.map((chip) => (
              <span key={chip} className="rounded-lg border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[11px] text-cyan-800">
                {chip}
              </span>
            ))}
            {chapter.steps.map((step) => (
              <span key={step} className="rounded-lg border border-[var(--border)] bg-white px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                {clip(step)}
              </span>
            ))}
            {chapter.jumps.filter((name) => !chapter.children.some((child) => child.name === name)).map((name) => (
              <span key={name} className="rounded-lg border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700">
                {clip(name)}
              </span>
            ))}
            {chapter.steps.length === 0 && chapter.jumps.length === 0 && chapter.looksUp.length === 0 && (
              <span className="text-xs text-[var(--text-muted)]">No spoken lines on this chart.</span>
            )}
          </span>
        )}
        {active && <span className="mt-2 block text-[11px] font-medium text-[var(--accent)]">Guest is here</span>}
        {lens === 'traffic' && (
          <span className="mt-1 block text-xs text-[var(--text-secondary)]">
            {chats ? `${chats} ${chats === 1 ? 'chat' : 'chats'} in 30 days` : 'No chats yet'}
          </span>
        )}
        {lens === 'health' && (
          <span className="mt-1 block text-xs text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{health?.label ?? 'Clear'}</span>
            {health?.detail ? ` · ${health.detail}` : ''}
          </span>
        )}
      </button>
      {chapter.suggested && (
        <div className="mt-2">
          <p className="text-[11px] font-medium text-amber-800">Suggested · not connected yet</p>
          <Button size="sm" className="mt-2" disabled={connecting} onClick={() => onConnect(chapter.id)}>
            {connecting ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      )}
      {automations.map((name) => (
        <Link
          key={name}
          to="/build/workflows"
          className="mt-2 block text-[11px] font-medium text-amber-800"
        >
          Automation · {name}
        </Link>
      ))}
    </div>
  )
}

function Column({
  chapter,
  nest = true,
  lens,
  chats,
  healthFor,
  automationsFor,
  connectingId,
  activeId,
  onOpen,
  onConnect,
}: {
  chapter: JourneyChapter
  nest?: boolean
  lens: JourneyLens
  chats: Record<string, number>
  healthFor: (id: string) => ChapterHealth | undefined
  automationsFor: (name: string) => string[]
  connectingId: string
  activeId?: string
  onOpen: (id: string) => void
  onConnect: (id: string) => void
}) {
  return (
    <div className="flex min-w-[200px] flex-col gap-3">
      <Chart
        chapter={chapter}
        lens={lens}
        chats={chats[chapter.id]}
        health={healthFor(chapter.id)}
        automations={automationsFor(chapter.name)}
        connecting={connectingId === chapter.id}
        active={activeId === chapter.id}
        onOpen={onOpen}
        onConnect={onConnect}
      />
      {nest && chapter.children.length > 0 && (
        <div className="ml-3 flex flex-col gap-3 border-l border-emerald-200 pl-3">
          {sortedChapters(chapter.children, lens, chats).map((child) => (
            <Column
              key={child.id}
              chapter={child}
              lens={lens}
              chats={chats}
              healthFor={healthFor}
              automationsFor={automationsFor}
              connectingId={connectingId}
              activeId={activeId}
              onOpen={onOpen}
              onConnect={onConnect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function sortedChapters(chapters: JourneyChapter[], lens: JourneyLens, chats: Record<string, number>): JourneyChapter[] {
  if (lens !== 'health') return chapters
  return [...chapters].sort((a, b) => (chats[b.id] ?? 0) - (chats[a.id] ?? 0))
}

export function JourneyMap({
  layout,
  lens,
  chats,
  healthFor,
  automationsFor,
  connectingId,
  activeId,
  onOpen,
  onConnect,
}: {
  layout: JourneyLayout
  lens: JourneyLens
  chats: Record<string, number>
  healthFor: (id: string) => ChapterHealth | undefined
  automationsFor: (name: string) => string[]
  connectingId: string
  activeId?: string
  onOpen: (id: string) => void
  onConnect: (id: string) => void
}) {
Wait, I need to insert sortedChapters before JourneyMap export, not replace the export. Let me read the current JourneyMap around the export.
  const shared = {
    lens,
    chats,
    healthFor,
    automationsFor,
    connectingId,
    activeId,
    onOpen,
    onConnect,
  }
  if (layout.roots.length === 0 && layout.suggested.length === 0 && layout.loose.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No chapters yet. Add one and it will sit here until a chart opens it.</p>
  }
  return (
    <div className="space-y-6">
      {(welcome || layout.suggested.length > 0) && (
        <div className="flex flex-wrap items-start gap-4">
          {welcome && <div className="max-w-md flex-1"><Column chapter={welcome} nest={false} {...shared} /></div>}
          {sortedChapters(layout.suggested, lens, chats).map((chapter) => (
            <div key={chapter.id} className="w-64">
              <Column chapter={chapter} {...shared} />
            </div>
          ))}
        </div>
      )}
      {welcome && welcome.children.length > 0 && (
        <div>
          <p className="mb-3 text-xs text-[var(--text-muted)]">Opens</p>
          <div className="grid items-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {sortedChapters(welcome.children, lens, chats).map((chapter) => (
              <Column key={chapter.id} chapter={chapter} {...shared} />
            ))}
          </div>
        </div>
      )}
      {otherRoots.length > 0 && (
        <div className="grid items-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {sortedChapters(otherRoots, lens, chats).map((chapter) => (
            <Column key={chapter.id} chapter={chapter} {...shared} />
          ))}
        </div>
      )}
      {layout.loose.length > 0 && (
        <div>
          <p className="mb-3 text-xs text-[var(--text-muted)]">Built, and nothing points here yet</p>
          <div className="grid items-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {sortedChapters(layout.loose, lens, chats).map((chapter) => (
              <Column key={chapter.id} chapter={chapter} {...shared} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
