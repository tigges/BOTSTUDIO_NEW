import React, { useEffect, useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { Badge, Button, Card, PageHeader, Skeleton } from '@botstudio/ui'
import { cn } from '@botstudio/ui'
import {
  MODEL_GROUPS,
  MODEL_IDS,
  RESPONSE_LENGTHS,
  RESPONSE_LENGTH_RULES,
  TOOL_WAIT_MAX_SECONDS,
  TOOL_WAIT_MIN_SECONDS,
  readBotSettings,
  type BotSettings,
  type ResponseLength,
} from '@botstudio/shared'
import { useBotSettings, useSaveBotSettings } from '../../lib/hooks'
import { ApiError } from '../../lib/api'

type Field = keyof BotSettings
const DEFAULT_WAIT = 20

interface Draft {
  model: string
  responseLength: ResponseLength
  escalate: boolean
  seconds: string
}

function draftOf(settings: BotSettings): Draft {
  return {
    model: settings.model,
    responseLength: settings.responseLength,
    escalate: settings.toolWaitEscalateSeconds !== null,
    seconds: String(settings.toolWaitEscalateSeconds ?? DEFAULT_WAIT),
  }
}

function bodyOf(draft: Draft) {
  return { model: draft.model, responseLength: draft.responseLength, toolWaitEscalateSeconds: draft.escalate ? draft.seconds : null }
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-2 text-xs text-[var(--error)]" role="alert">{message}</p>
}

export function BotSettingsPage() {
  const query = useBotSettings()
  const save = useSaveBotSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (query.data && !draft) setDraft(draftOf(query.data.settings))
  }, [query.data, draft])

  const update = (patch: Partial<Draft>, field: Field) => {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setSaved(false)
  }

  const stored = query.data ? draftOf(query.data.settings) : null
  const dirty = Boolean(draft && stored && JSON.stringify(bodyOf(draft)) !== JSON.stringify(bodyOf(stored)))
  const connected = query.data?.connected ?? {}
  const group = draft ? MODEL_GROUPS.find((item) => item.models.some((model) => model.value === draft.model)) : undefined
  const modelNote = group?.models.find((model) => model.value === draft?.model)?.note

  async function submit() {
    if (!draft) return
    setFormError('')
    const checked = readBotSettings(bodyOf(draft), MODEL_IDS)
    if (!checked.ok) {
      setErrors({ [checked.field]: checked.message })
      return
    }
    try {
      const data = await save.mutateAsync(checked.settings)
      setDraft(draftOf(data.settings))
      setErrors({})
      setSaved(true)
    } catch (err) {
      const field = err instanceof ApiError ? err.body?.['field'] : undefined
      const message = err instanceof Error ? err.message : 'Saving failed. Try again.'
      if (typeof field === 'string') setErrors({ [field]: message })
      else setFormError(message)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Bot settings"
        description="Three settings shape how this bot runs. Prompts, temperature and token budgets are managed by BotStudio."
        actions={
          <Button size="md" onClick={() => { void submit() }} disabled={!dirty || save.isPending} data-testid="bot-settings-save">
            {save.isPending ? 'Saving…' : saved && !dirty ? <><CheckCircle size={14} /> Saved</> : 'Save settings'}
          </Button>
        }
      />
      <div className="flex-1 overflow-auto p-6">
        {query.isLoading && (
          <div className="max-w-2xl space-y-4">
            {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-32 w-full rounded-xl" />)}
          </div>
        )}
        {query.isError && (
          <div className="max-w-2xl">
            <p className="text-sm text-[var(--text-secondary)]">{query.error instanceof Error ? query.error.message : 'Could not load the bot settings.'}</p>
            <Button className="mt-3" size="md" variant="secondary" onClick={() => { void query.refetch() }}>Try again</Button>
          </div>
        )}
        {draft && (
          <div className="max-w-2xl space-y-4">
            <Card>
              <label htmlFor="bot-model" className="text-sm font-semibold text-[var(--text-primary)]">Model</label>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">Writes every reply, and runs AI steps and routing.</p>
              <select
                id="bot-model"
                value={draft.model}
                onChange={(event) => update({ model: event.target.value }, 'model')}
                aria-invalid={Boolean(errors.model)}
                className={cn(
                  'mt-3 w-full rounded border bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none',
                  errors.model ? 'border-[var(--error)]' : 'border-[var(--border)]',
                )}
              >
                {!MODEL_IDS.includes(draft.model) && <option value={draft.model}>{draft.model} (no longer offered)</option>}
                {MODEL_GROUPS.map((item) => (
                  <optgroup key={item.label} label={`${item.label}${connected[item.envVar] ? '' : ' · not connected'}`}>
                    {item.models.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
                  </optgroup>
                ))}
              </select>
              {group && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                  {connected[group.envVar]
                    ? <Badge variant="success" dot>Connected</Badge>
                    : <Badge variant="warning" dot>Not connected</Badge>}
                  {modelNote && <span>{modelNote}</span>}
                </div>
              )}
              {group && !connected[group.envVar] && (
                <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="bot-settings-not-connected">
                  This BotStudio has no key for {group.label}, so replies come from the next connected provider. To use this model, an admin sets <code className="rounded bg-[var(--bg-elevated)] px-1 font-mono">{group.envVar}</code> on the server.
                </p>
              )}
              <FieldError message={errors.model} />
            </Card>

            <Card>
              <p className="text-sm font-semibold text-[var(--text-primary)]" id="bot-length">Response length</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">How long answers from the knowledge base are.</p>
              <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="bot-length">
                {RESPONSE_LENGTHS.map((value) => {
                  const rule = RESPONSE_LENGTH_RULES[value]
                  const on = draft.responseLength === value
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => update({ responseLength: value }, 'responseLength')}
                      className={cn(
                        'rounded-[var(--radius)] border p-3 text-left transition-colors',
                        on ? 'border-[var(--accent)] bg-[var(--accent-muted)]' : 'border-[var(--border)] hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      <span className={cn('block text-sm font-medium', on ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]')}>{rule.label}</span>
                      <span className="mt-1 block text-xs text-[var(--text-muted)]">{rule.help}</span>
                    </button>
                  )
                })}
              </div>
              <FieldError message={errors.responseLength} />
            </Card>

            <Card>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Slow tools</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                When a Run tool step keeps the guest waiting, hand the chat to a person instead.
              </p>
              <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={draft.escalate}
                  onChange={(event) => update({ escalate: event.target.checked }, 'toolWaitEscalateSeconds')}
                  data-testid="bot-settings-escalate"
                />
                Hand over when a tool has not answered after
                <input
                  type="number"
                  min={TOOL_WAIT_MIN_SECONDS}
                  max={TOOL_WAIT_MAX_SECONDS}
                  step={1}
                  value={draft.seconds}
                  disabled={!draft.escalate}
                  onChange={(event) => update({ seconds: event.target.value }, 'toolWaitEscalateSeconds')}
                  aria-label="Seconds to wait for a tool"
                  aria-invalid={Boolean(errors.toolWaitEscalateSeconds)}
                  className={cn(
                    'w-20 rounded border bg-[var(--bg-overlay)] px-2 py-1 text-sm text-[var(--text-primary)] disabled:opacity-50 focus:border-[var(--border-focus)] focus:outline-none',
                    errors.toolWaitEscalateSeconds ? 'border-[var(--error)]' : 'border-[var(--border)]',
                  )}
                />
                seconds
              </label>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                {draft.escalate
                  ? 'The chat lands in the Inbox with high priority and the tag tool-wait, and the handover reason names the tool that stalled.'
                  : `Off: the bot waits for the tool's own timeout. Turn this on to set ${TOOL_WAIT_MIN_SECONDS} to ${TOOL_WAIT_MAX_SECONDS} seconds.`}
              </p>
              <FieldError message={errors.toolWaitEscalateSeconds} />
            </Card>

            {formError && <p className="text-sm text-[var(--error)]" role="alert">{formError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
