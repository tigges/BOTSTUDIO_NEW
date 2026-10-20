import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, EyeOff, Loader2, Plus, ShieldCheck, Trash2, FlaskConical, Lock } from 'lucide-react'
import {
  Badge, Button, EmptyState, cn,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@ybot/ui'
import {
  BLOCKED_INPUT_LINE,
  BLOCKED_OUTPUT_LINE,
  DEFAULT_PRIVACY,
  GUARDRAIL_ACTIONS,
  GUARDRAIL_ACTION_HINTS,
  GUARDRAIL_ACTION_LABELS,
  GUARDRAIL_CHECK_LABELS,
  GUARDRAIL_SIDES,
  GUARDRAIL_SIDE_LABELS,
  PERSONAL_DATA_KINDS,
  PERSONAL_DATA_LABELS,
  PRIVACY_READERS,
  PRIVACY_READER_HINTS,
  PRIVACY_READER_LABELS,
  RENDER_MODES,
  RENDER_MODE_LABELS,
  REASK_LINE,
  REVEAL_TO_AGENTS_WARNING,
  guardrailIssues,
  newGuardrailRule,
  privacyIssues,
  readerMode,
  type GuardrailCheck,
  type GuardrailRule,
  type PrivacySettings,
  type RenderMode,
} from '@ybot/shared'
import type { GuardrailPolicyRow, SafetyTestResult } from '../../lib/api'
import { usePolicyAction, useSafety, useSafetyTest, useSavePolicy, useSavePrivacy } from '../../lib/hooks'
import { useAppStore } from '../../store/app'

const field = 'rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none'

function newId(): string {
  return `r_${Math.random().toString(36).slice(2, 10)}`
}

function errorText(err: unknown): string | null {
  return err instanceof Error ? err.message : null
}

export function SafetyPage() {
  const { data, isLoading, isError, refetch } = useSafety()
  const [tab, setTab] = useState<'privacy' | 'guardrails'>('privacy')
  const [privacy, setPrivacy] = useState<PrivacySettings>(DEFAULT_PRIVACY)
  const [editing, setEditing] = useState<{ id?: string; name: string; rules: GuardrailRule[] } | null>(null)

  useEffect(() => { if (data) setPrivacy(data.privacy) }, [data])

  const activePolicy = data?.policies.find((policy) => policy.active)
  const testRules = editing?.rules ?? activePolicy?.rules ?? []
  const testRulesFrom = editing ? `${editing.name || 'the policy you are editing'} (unsaved)` : activePolicy ? activePolicy.name : 'no active policy'

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="px-6 py-4">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Safety</h1>
          <p className="text-xs text-[var(--text-muted)]">How this bot handles personal data, and the content rules every guest message and bot reply is checked against.</p>
        </div>
        <div className="flex gap-4 px-6">
          {([['privacy', 'Personal data', EyeOff], ['guardrails', 'Guardrails', ShieldCheck]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn('flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium', tab === id ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]')}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-xs text-[var(--text-muted)]"><Loader2 size={16} className="mr-2 animate-spin" /> Loading safety settings…</div>
        ) : isError || !data ? (
          <EmptyState icon={<AlertCircle size={20} />} title="Safety settings could not be loaded" description="Check your connection and try again." action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>} />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              {tab === 'privacy'
                ? <PrivacyPanel saved={data.privacy} draft={privacy} onChange={setPrivacy} />
                : <GuardrailsPanel policies={data.policies} editing={editing} onEdit={setEditing} />}
            </div>
            <LiveTest privacy={privacy} rules={testRules} rulesFrom={testRulesFrom} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Personal data ────────────────────────────────────────────────────────────

function PrivacyPanel({ saved, draft, onChange }: { saved: PrivacySettings; draft: PrivacySettings; onChange: (next: PrivacySettings) => void }) {
  const save = useSavePrivacy()
  const isAdmin = useAppStore((s) => s.user?.role === 'ADMIN')
  const [confirming, setConfirming] = useState(false)
  const issues = useMemo(() => privacyIssues(draft), [draft])
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)
  const turningRevealOn = draft.revealToAgents && !saved.revealToAgents

  function setMode(reader: (typeof PRIVACY_READERS)[number], mode: RenderMode) {
    onChange({ ...draft, render: { ...draft.render, [reader]: mode } })
  }

  function submit(confirmReveal = false) {
    save.mutate({ ...draft, ...(confirmReveal ? { confirmReveal: true } : {}) }, { onSuccess: () => setConfirming(false) })
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <div className="flex items-start gap-2">
          <Lock size={14} className="mt-0.5 text-[var(--accent)]" />
          <div>
            <p className="text-xs font-medium text-[var(--text-primary)]">The model never sees personal data</p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">Before every model call, email addresses, phone numbers, card numbers, bank accounts, national IDs, IP addresses and your own patterns are swapped for a stable token such as [EMAIL_3F9A1C2B]. The same value always gets the same token, so the bot can still refer to it. This cannot be turned off.</p>
          </div>
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Who sees what</h2>
          <p className="text-xs text-[var(--text-muted)]">Choose how personal data appears to each reader. Passwords, API keys and tokens are always removed from logs.</p>
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {PRIVACY_READERS.map((reader) => {
            const agentRow = reader === 'human_agent'
            const shownMode = readerMode(draft, reader)
            return (
              <li key={reader} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--text-primary)]">{PRIVACY_READER_LABELS[reader]}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{PRIVACY_READER_HINTS[reader]}</p>
                </div>
                <select
                  aria-label={`${PRIVACY_READER_LABELS[reader]} view`}
                  className={cn(field, 'w-56')}
                  value={shownMode}
                  disabled={agentRow && draft.revealToAgents}
                  onChange={(e) => setMode(reader, e.target.value as RenderMode)}
                >
                  {RENDER_MODES.filter((mode) => !agentRow || mode !== 'original' || draft.revealToAgents).map((mode) => (
                    <option key={mode} value={mode}>{RENDER_MODE_LABELS[mode]}</option>
                  ))}
                </select>
              </li>
            )
          })}
        </ul>
        <div className={cn('border-t border-[var(--border)] px-4 py-3', draft.revealToAgents && 'bg-[var(--warning-muted)]')}>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft.revealToAgents}
              disabled={!isAdmin && !draft.revealToAgents}
              onChange={(e) => onChange({ ...draft, revealToAgents: e.target.checked })}
            />
            <span>
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                <AlertTriangle size={12} className="text-[var(--warning)]" /> Show personal data to human agents as written
              </span>
              <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">{REVEAL_TO_AGENTS_WARNING}</span>
              {!isAdmin && <span className="mt-1 block text-[11px] text-[var(--text-muted)]">Only an admin can turn this on.</span>}
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-[var(--text-primary)]">Your own patterns</h2>
            <p className="text-xs text-[var(--text-muted)]">Anything else that counts as personal data for your business, such as membership or order numbers.</p>
          </div>
          <Button size="sm" variant="secondary" disabled={draft.custom.length >= 20} onClick={() => onChange({ ...draft, custom: [...draft.custom, { name: '', pattern: '' }] })}>
            <Plus size={12} className="mr-1" /> Add pattern
          </Button>
        </div>
        {draft.custom.length === 0 ? (
          <p className="px-4 py-4 text-xs text-[var(--text-muted)]">No patterns yet. The built-in kinds above are always checked.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {draft.custom.map((entry, index) => {
              const rowIssues = issues.filter((issue) => issue.field.startsWith(`custom.${index}.`))
              const update = (next: Partial<typeof entry>) => onChange({ ...draft, custom: draft.custom.map((item, i) => (i === index ? { ...item, ...next } : item)) })
              return (
                <li key={index} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input aria-label="Pattern name" placeholder="Name, e.g. Membership number" className={cn(field, 'w-56')} value={entry.name} onChange={(e) => update({ name: e.target.value })} />
                    <input aria-label="Pattern" placeholder="Pattern, e.g. \bMB-\d{6}\b" className={cn(field, 'flex-1 font-mono')} value={entry.pattern} onChange={(e) => update({ pattern: e.target.value })} />
                    <button aria-label={`Remove ${entry.name || 'pattern'}`} className="text-[var(--text-muted)] hover:text-[var(--error)]" onClick={() => onChange({ ...draft, custom: draft.custom.filter((_, i) => i !== index) })}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {rowIssues.map((issue) => <p key={issue.field + issue.message} className="mt-1 text-[11px] text-[var(--error)]">{issue.message}</p>)}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="flex items-center justify-end gap-3">
        {save.isError && <p className="text-xs text-[var(--error)]">{errorText(save.error)}</p>}
        {save.isSuccess && !dirty && <p className="text-xs text-[var(--success)]">Saved.</p>}
        <Button size="sm" variant="secondary" disabled={!dirty || save.isPending} onClick={() => onChange(saved)}>Discard</Button>
        <Button size="sm" disabled={!dirty || issues.length > 0 || save.isPending} onClick={() => (turningRevealOn ? setConfirming(true) : submit())}>
          {save.isPending ? <Loader2 size={12} className="mr-1 animate-spin" /> : null} Save personal data settings
        </Button>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Show personal data to human agents?</DialogTitle>
            <DialogDescription>{REVEAL_TO_AGENTS_WARNING}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-xs text-[var(--text-muted)]">The model still only ever gets tokens. This change is recorded in the Audit Log.</p>
          </DialogBody>
          <DialogFooter>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button size="sm" onClick={() => submit(true)} disabled={save.isPending}>Show personal data to agents</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Guardrails ──────────────────────────────────────────────────────────────

type Editing = { id?: string; name: string; rules: GuardrailRule[] }

function GuardrailsPanel({ policies, editing, onEdit }: { policies: GuardrailPolicyRow[]; editing: Editing | null; onEdit: (next: Editing | null) => void }) {
  const action = usePolicyAction()

  if (editing) return <PolicyEditor editing={editing} onChange={onEdit} onDone={() => onEdit(null)} />

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-xs text-[var(--text-muted)]">
        <p><span className="font-medium text-[var(--text-primary)]">One policy is active at a time.</span> Its rules check every guest message and bot reply on every channel, the test chat included. New rules start on Warn, so nothing is stopped until you choose to.</p>
        <p className="mt-1">Rules about what must happen before an action (require, limit, block) are business constraints and live on the flow step, not here.</p>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">Policies</h2>
        <Button size="sm" onClick={() => onEdit({ name: '', rules: [newGuardrailRule({ id: newId() })] })}><Plus size={12} className="mr-1" /> New policy</Button>
      </div>

      {action.isError && <p className="text-xs text-[var(--error)]">{errorText(action.error)}</p>}

      {policies.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={20} />}
          title="No guardrail policy yet"
          description="Without an active policy, messages are only checked for personal data. Add a policy to warn on, block, redact or escalate content."
          action={<Button size="sm" onClick={() => onEdit({ name: 'Default', rules: [newGuardrailRule({ id: newId() })] })}><Plus size={12} className="mr-1" /> New policy</Button>}
        />
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
          {policies.map((policy) => {
            const enabled = policy.rules.filter((rule) => rule.enabled)
            const stops = enabled.filter((rule) => rule.action !== 'warn').length
            return (
              <li key={policy.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => onEdit({ id: policy.id, name: policy.name, rules: policy.rules })}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--text-primary)]">{policy.name}</span>
                    {policy.active ? <Badge variant="success" dot>Active</Badge> : <Badge variant="muted">Inactive</Badge>}
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                    {enabled.length} of {policy.rules.length} {policy.rules.length === 1 ? 'rule' : 'rules'} on · {stops} can change a message · updated {new Date(policy.updatedAt).toLocaleString()}
                  </p>
                </button>
                {policy.active ? (
                  <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ id: policy.id, action: 'deactivate' })}>Turn off</Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ id: policy.id, action: 'activate' })}>Make active</Button>
                )}
                <button
                  aria-label={`Delete ${policy.name}`}
                  className="text-[var(--text-muted)] hover:text-[var(--error)]"
                  onClick={() => { if (window.confirm(`Delete ${policy.name}?${policy.active ? ' It is active: messages will no longer be checked against any rules.' : ''}`)) action.mutate({ id: policy.id, action: 'delete' }) }}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function checkFor(kind: GuardrailCheck['kind'], previous: GuardrailCheck): GuardrailCheck {
  if (kind === previous.kind) return previous
  if (kind === 'pattern') return { kind, pattern: '' }
  if (kind === 'personal_data') return { kind, kinds: ['card'] }
  return { kind, words: [] }
}

function defaultLine(rule: GuardrailRule): string {
  if (rule.action === 'reask') return REASK_LINE
  return rule.side === 'output' ? BLOCKED_OUTPUT_LINE : BLOCKED_INPUT_LINE
}

function PolicyEditor({ editing, onChange, onDone }: { editing: Editing; onChange: (next: Editing) => void; onDone: () => void }) {
  const save = useSavePolicy()
  const issues = useMemo(() => guardrailIssues(editing.rules), [editing.rules])
  const nameMissing = !editing.name.trim()

  function updateRule(id: string, next: Partial<GuardrailRule>) {
    onChange({ ...editing, rules: editing.rules.map((rule) => (rule.id === id ? { ...rule, ...next } : rule)) })
  }

  function submit() {
    save.mutate({ id: editing.id, body: { name: editing.name.trim(), rules: editing.rules } }, { onSuccess: onDone })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input aria-label="Policy name" placeholder="Policy name" className={cn(field, 'w-72 text-sm')} value={editing.name} onChange={(e) => onChange({ ...editing, name: e.target.value })} />
        {nameMissing && <span className="text-[11px] text-[var(--error)]">Give the policy a name.</span>}
      </div>

      <ul className="space-y-3">
        {editing.rules.map((rule) => {
          const ruleIssues = issues.filter((issue) => issue.ruleId === rule.id)
          return (
            <li key={rule.id} className={cn('rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-4', ruleIssues.length ? 'border-[var(--error)]' : 'border-[var(--border)]', !rule.enabled && 'opacity-70')}>
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="Rule name" placeholder="Rule name, e.g. No competitor names" className={cn(field, 'min-w-48 flex-1')} value={rule.name} onChange={(e) => updateRule(rule.id, { name: e.target.value })} />
                <label className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                  <input type="checkbox" checked={rule.enabled} onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })} /> On
                </label>
                <button aria-label={`Remove ${rule.name || 'rule'}`} className="text-[var(--text-muted)] hover:text-[var(--error)]" onClick={() => onChange({ ...editing, rules: editing.rules.filter((r) => r.id !== rule.id) })}>
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-[11px] text-[var(--text-muted)]">
                  <span>Checks</span>
                  <select className={cn(field, 'w-full')} value={rule.side} onChange={(e) => updateRule(rule.id, { side: e.target.value as GuardrailRule['side'] })}>
                    {GUARDRAIL_SIDES.map((side) => <option key={side} value={side}>{GUARDRAIL_SIDE_LABELS[side]}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-[11px] text-[var(--text-muted)]">
                  <span>Looks for</span>
                  <select className={cn(field, 'w-full')} value={rule.check.kind} onChange={(e) => updateRule(rule.id, { check: checkFor(e.target.value as GuardrailCheck['kind'], rule.check) })}>
                    {(Object.keys(GUARDRAIL_CHECK_LABELS) as Array<GuardrailCheck['kind']>).map((kind) => <option key={kind} value={kind}>{GUARDRAIL_CHECK_LABELS[kind]}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-[11px] text-[var(--text-muted)]">
                  <span>Then</span>
                  <select className={cn(field, 'w-full')} value={rule.action} onChange={(e) => updateRule(rule.id, { action: e.target.value as GuardrailRule['action'] })}>
                    {GUARDRAIL_ACTIONS.map((a) => <option key={a} value={a}>{GUARDRAIL_ACTION_LABELS[a]}</option>)}
                  </select>
                </label>
              </div>
              <p className="mt-1 text-right text-[11px] text-[var(--text-muted)]">{GUARDRAIL_ACTION_HINTS[rule.action]}</p>

              <div className="mt-2">
                {rule.check.kind === 'words' && (
                  <textarea
                    aria-label="Words or phrases"
                    rows={2}
                    placeholder="One word or phrase per line"
                    className={cn(field, 'w-full')}
                    value={rule.check.words.join('\n')}
                    onChange={(e) => updateRule(rule.id, { check: { kind: 'words', words: e.target.value.split('\n') } })}
                    onBlur={(e) => updateRule(rule.id, { check: { kind: 'words', words: e.target.value.split('\n').map((w) => w.trim()).filter(Boolean) } })}
                  />
                )}
                {rule.check.kind === 'pattern' && (
                  <input aria-label="Pattern" placeholder="e.g. \bpromo code\b" className={cn(field, 'w-full font-mono')} value={rule.check.pattern} onChange={(e) => updateRule(rule.id, { check: { kind: 'pattern', pattern: e.target.value } })} />
                )}
                {rule.check.kind === 'personal_data' && (
                  <div className="flex flex-wrap gap-3">
                    {PERSONAL_DATA_KINDS.map((kind) => {
                      const kinds = (rule.check as { kinds: string[] }).kinds
                      return (
                        <label key={kind} className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                          <input
                            type="checkbox"
                            checked={kinds.includes(kind)}
                            onChange={(e) => updateRule(rule.id, { check: { kind: 'personal_data', kinds: e.target.checked ? [...kinds, kind] : kinds.filter((k) => k !== kind) } })}
                          />
                          {PERSONAL_DATA_LABELS[kind]}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {(rule.action === 'block' || rule.action === 'reask') && (
                <label className="mt-2 block space-y-1 text-[11px] text-[var(--text-muted)]">
                  <span>What the bot says instead</span>
                  <input className={cn(field, 'w-full')} placeholder={defaultLine(rule)} value={rule.message} onChange={(e) => updateRule(rule.id, { message: e.target.value })} />
                </label>
              )}

              {ruleIssues.map((issue) => <p key={issue.field + issue.message} className="mt-1 text-[11px] text-[var(--error)]">{issue.message}</p>)}
            </li>
          )
        })}
      </ul>

      <Button size="sm" variant="secondary" disabled={editing.rules.length >= 100} onClick={() => onChange({ ...editing, rules: [...editing.rules, newGuardrailRule({ id: newId() })] })}>
        <Plus size={12} className="mr-1" /> Add rule
      </Button>

      <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] pt-4">
        {save.isError && <p className="text-xs text-[var(--error)]">{errorText(save.error)}</p>}
        <Button size="sm" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button size="sm" disabled={nameMissing || issues.length > 0 || save.isPending} onClick={submit}>
          {save.isPending ? <Loader2 size={12} className="mr-1 animate-spin" /> : null} Save policy
        </Button>
      </div>
    </div>
  )
}

// ── Live Test ───────────────────────────────────────────────────────────────

const OUTCOME_LABEL: Record<SafetyTestResult['guardrails']['outcome'], string> = {
  allow: 'Goes through',
  block: 'Blocked',
  escalate: 'Handed to a person',
  reask: 'Asked again',
}

function LiveTest({ privacy, rules, rulesFrom }: { privacy: PrivacySettings; rules: GuardrailRule[]; rulesFrom: string }) {
  const test = useSafetyTest()
  const [text, setText] = useState('Hi, I am jane.doe@example.com, call me on +44 7700 900123. My card is 4111 1111 1111 1111.')
  const [side, setSide] = useState<'input' | 'output'>('input')
  const result = test.data

  return (
    <aside className="h-fit rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 xl:sticky xl:top-0">
      <div className="flex items-center gap-1.5">
        <FlaskConical size={13} className="text-[var(--accent)]" />
        <h2 className="text-sm font-medium text-[var(--text-primary)]">Live Test</h2>
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Uses the settings on screen, saved or not. Rules from {rulesFrom}.</p>
      <textarea aria-label="Test message" rows={4} className={cn(field, 'mt-3 w-full')} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex items-center gap-2">
        <select aria-label="Message from" className={cn(field, 'flex-1')} value={side} onChange={(e) => setSide(e.target.value as 'input' | 'output')}>
          <option value="input">As a guest message</option>
          <option value="output">As a bot reply</option>
        </select>
        <Button size="sm" disabled={!text.trim() || test.isPending} onClick={() => test.mutate({ text, side, privacy, rules })}>
          {test.isPending ? <Loader2 size={12} className="mr-1 animate-spin" /> : null} Test
        </Button>
      </div>
      {test.isError && <p className="mt-2 text-xs text-[var(--error)]">{errorText(test.error)}</p>}

      {result && (
        <div className="mt-4 space-y-3 text-xs">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Found</p>
            <p className="mt-0.5 text-[var(--text-secondary)]">
              {result.found.length === 0 ? 'No personal data.' : result.found.map((span) => span.kind.replace(/_/g, ' ')).join(', ')}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Model gets</p>
            <p className="mt-0.5 break-words font-mono text-[11px] text-[var(--text-primary)]">{result.model}</p>
          </div>
          {PRIVACY_READERS.map((reader) => (
            <div key={reader}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{PRIVACY_READER_LABELS[reader]} sees</p>
              <p className="mt-0.5 break-words text-[var(--text-primary)]">{result.readers[reader]}</p>
            </div>
          ))}
          <div className="rounded border border-[var(--border)] p-2">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Guardrails</p>
              <Badge variant={result.guardrails.outcome === 'allow' ? (result.guardrails.hits.length ? 'warning' : 'success') : 'error'}>
                {OUTCOME_LABEL[result.guardrails.outcome]}
              </Badge>
            </div>
            {result.guardrails.hits.length === 0 ? (
              <p className="mt-1 text-[var(--text-muted)]">{rules.length ? 'No rule matched.' : 'No rules to check.'}</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {result.guardrails.hits.map((hit) => (
                  <li key={hit.ruleId} className="text-[var(--text-secondary)]">{hit.name}: {GUARDRAIL_ACTION_LABELS[hit.action]}</li>
                ))}
              </ul>
            )}
            {result.guardrails.line && <p className="mt-1 text-[var(--text-primary)]">Bot says: “{result.guardrails.line}”</p>}
            {result.guardrails.outcome === 'allow' && result.guardrails.text !== text && <p className="mt-1 text-[var(--text-primary)]">Carries on as: “{result.guardrails.text}”</p>}
          </div>
        </div>
      )}
    </aside>
  )
}
