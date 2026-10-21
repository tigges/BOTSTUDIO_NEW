import React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search, CornerDownLeft } from 'lucide-react'
import { useAppStore } from '../store/app'
import { useFlows } from '../lib/hooks'
import { NAV_GROUPS } from './nav-config'
import { COMMAND_GROUPS, isPaletteShortcut, paletteCommands, rankCommands, type PaletteCommand } from '../lib/command-palette'

const BUILD_ROLES = ['DEVELOPER', 'SUPERVISOR', 'ADMIN']

const PAGES = NAV_GROUPS.flatMap((group) =>
  group.items.flatMap((item) =>
    item.subItems?.length
      ? item.subItems.map((sub) => ({ id: sub.id, label: sub.label === item.label ? item.label : `${item.label} · ${sub.label}`, path: sub.path, section: group.label }))
      : [{ id: item.id, label: item.label, path: item.path, section: group.label }],
  ),
)


export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { bots, selectedBotId, selectedEnv, selectBot, setEnv, user } = useAppStore()
  const { data: flows = [] } = useFlows()
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return
      event.preventDefault()
      onOpenChange(!open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
  }, [open])

  const commands = React.useMemo(() => paletteCommands({
    pages: PAGES,
    bots: bots.map((bot) => ({ id: bot.id, name: bot.name })),
    selectedBotId,
    flows: flows.map((flow) => ({ id: flow.id, name: flow.name })),
    selectedEnv,
    canBuild: BUILD_ROLES.includes(user?.role ?? ''),
  }), [bots, selectedBotId, flows, selectedEnv, user?.role])

  const results = React.useMemo(() => rankCommands(query, commands), [query, commands])

  React.useEffect(() => { setActive(0) }, [query])
  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const run = (cmd: PaletteCommand) => {
    onOpenChange(false)
    const target = cmd.target
    if (target.kind === 'path') navigate({ to: target.to })
    else if (target.kind === 'bot') { selectBot(target.botId); navigate({ to: '/overview' }) }
    else setEnv(target.env)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (event.key === 'Enter') { event.preventDefault(); const cmd = results[active]; if (cmd) run(cmd) }
    else if (event.key === 'Escape') { event.preventDefault(); onOpenChange(false) }
  }

  const grouped = query.trim()
    ? [{ group: 'Results', items: results }]
    : COMMAND_GROUPS.map((group) => ({ group, items: results.filter((cmd) => cmd.group === group) })).filter((row) => row.items.length)

  let index = -1
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]" onMouseDown={() => onOpenChange(false)}>
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4">
          <Search size={15} className="text-[var(--text-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Go to a page, bot or flow, or run an action…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
            className="h-12 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <kbd className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">Esc</kbd>
        </div>
        <div ref={listRef} id="palette-results" role="listbox" className="max-h-[50vh] overflow-auto py-1">
          {results.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
              Nothing matches “{query.trim()}”. Try a page name such as Inbox or Releases, or a flow name.
            </p>
          )}
          {grouped.map(({ group, items }) => (
            <div key={group} className="py-1">
              <p className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{group}</p>
              {items.map((cmd) => {
                index += 1
                const i = index
                const selected = i === active
                return (
                  <button
                    key={cmd.id}
                    id={`palette-${cmd.id}`}
                    data-index={i}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(cmd)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${selected ? 'bg-[var(--accent-muted)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    <span className="flex-1 truncate">{cmd.label}</span>
                    {query.trim() && <span className="shrink-0 text-xs text-[var(--text-muted)]">{cmd.group}</span>}
                    {cmd.hint && <span className="shrink-0 text-xs text-[var(--text-muted)]">{cmd.hint}</span>}
                    {selected && <CornerDownLeft size={12} className="shrink-0 text-[var(--text-muted)]" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
