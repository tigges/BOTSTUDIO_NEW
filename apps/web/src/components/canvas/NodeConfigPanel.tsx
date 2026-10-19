import React, { useState } from 'react'
import { X, ChevronDown, ChevronUp } from 'lucide-react'
import { Button, Input } from '@ybot/ui'
import type { FlowIssue, NodeKind } from '@ybot/shared'
import {
  AI_DEFAULT_TURNS, AI_MAX_TURNS, HANDOVER_PRIORITIES, NODE_DEFINITIONS, SWITCHABLE_STEP_KINDS,
  handoverContext, handoverPriority, stepMode,
} from '@ybot/shared'
import type { Node } from '@xyflow/react'
import type { FlowNodeData } from './FlowNode'
import { RouterEditor } from './RouterEditor'
import { RunToolEditor } from './RunToolEditor'

interface NodeConfigPanelProps {
  node: Node | null
  /** What the flow check says about this step right now. */
  issues?: FlowIssue[]
  onUpdate: (nodeId: string, data: Partial<FlowNodeData>) => void
  onDelete: (nodeId: string) => void
  onClose: () => void
}

const AI_FIELDS: ConfigField[] = [
  { key: 'goal', label: 'Goal', type: 'textarea', placeholder: 'Find out which colour the guest wants', hint: 'What the model works toward on this step.' },
  { key: 'exitWhen', label: 'Exit when', type: 'text', placeholder: 'The guest has named one colour', hint: 'Once this is true the step follows its Done line.' },
  {
    key: 'maxTurns', label: 'Turn limit', type: 'number', placeholder: String(AI_DEFAULT_TURNS),
    hint: `Replies the model may send here, 1 to ${AI_MAX_TURNS}. At the limit the step follows its Turn limit line, or its Done line when Turn limit is not connected.`,
  },
]

interface ConfigField {
  key: string
  label: string
  type: string
  placeholder?: string
  hint?: string
  options?: Array<{ value: string; label: string }>
}

const HANDOVER_FIELDS: ConfigField[] = [
  { key: 'reason', label: 'Reason', type: 'text', placeholder: 'Colour correction needs a stylist', hint: 'The first line the team sees. {{variables}} work here.' },
  {
    key: 'priority', label: 'Priority', type: 'select',
    options: HANDOVER_PRIORITIES.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
  },
  { key: 'tags', label: 'Tags', type: 'text', placeholder: 'colour, vip', hint: 'Separate with commas.' },
  { key: 'summary', label: 'Summary for the team', type: 'textarea', placeholder: 'Leave empty to write one from the chat' },
  { key: 'variables', label: 'Variables to pass on', type: 'text', placeholder: 'service, preferred_day', hint: 'Leave empty to pass every answer the guest gave.' },
  { key: 'queue', label: 'Queue', type: 'text', placeholder: 'support' },
  { key: 'skills', label: 'Skills', type: 'text', placeholder: 'colour, bookings', hint: 'Separate with commas.' },
  { key: 'queuePriority', label: 'Queue priority (number)', type: 'number', placeholder: 'Follows the priority', hint: 'Higher is more urgent.' },
  {
    key: 'context', label: 'What travels with the chat', type: 'select',
    options: [
      { value: 'full_transcript', label: 'Full transcript' },
      { value: 'summary_only', label: 'Summary only' },
    ],
    hint: 'Summary only keeps the transcript out of webhooks. The Inbox still shows the chat.',
  },
]

const CONFIG_FIELDS: Partial<Record<NodeKind, ConfigField[]>> = {
  send_message: [
    { key: 'text', label: 'Message text', type: 'textarea', placeholder: 'Hello {{user.name}}! How can I help?' },
  ],
  ask_question: [
    { key: 'question', label: 'Question text', type: 'textarea', placeholder: 'What is your email address?' },
    { key: 'variable', label: 'Save answer to variable', type: 'text', placeholder: 'user.email' },
    { key: 'validation', label: 'Validation type', type: 'select', placeholder: 'none' },
  ],
  condition: [
    { key: 'expression', label: 'Condition expression', type: 'text', placeholder: '{{user.tier}} == "premium"' },
    { key: 'conditions', label: 'Conditions (JSON)', type: 'textarea', placeholder: '[{"field":"intent","operator":"equals","value":"order_status"}]' },
    { key: 'description', label: 'Description', type: 'text', placeholder: 'Check user tier' },
  ],
  set_variable: [
    { key: 'variable', label: 'Variable name', type: 'text', placeholder: 'flow.status' },
    { key: 'value', label: 'Value', type: 'text', placeholder: '"pending"' },
  ],
  http_request: [
    { key: 'url', label: 'URL', type: 'text', placeholder: 'https://api.example.com/data' },
    { key: 'method', label: 'Method', type: 'select', placeholder: 'GET' },
    { key: 'body', label: 'Request body (JSON)', type: 'textarea', placeholder: '{"key": "{{flow.value}}"}' },
    { key: 'saveAs', label: 'Save response to', type: 'text', placeholder: 'flow.apiResponse' },
  ],
  transfer_agent: HANDOVER_FIELDS,
  delay: [
    { key: 'seconds', label: 'Delay (seconds)', type: 'number', placeholder: '5' },
  ],
  send_email: [
    { key: 'to', label: 'To', type: 'text', placeholder: '{{user.email}}' },
    { key: 'subject', label: 'Subject', type: 'text', placeholder: 'Your order update' },
    { key: 'body', label: 'Body', type: 'textarea', placeholder: 'Hello {{user.name}}…' },
  ],
  llm_prompt: [
    { key: 'prompt', label: 'Instructions', type: 'textarea', placeholder: 'Answer in two sentences. Mention the booking link.' },
    { key: 'systemPrompt', label: 'System prompt', type: 'textarea', placeholder: 'You are a friendly assistant…' },
    { key: 'saveAs', label: 'Save response to', type: 'text', placeholder: 'flow.llmResponse' },
    { key: 'model', label: 'Model override', type: 'text', placeholder: 'Leave empty to use bot default' },
  ],
  llm_generate: [
    { key: 'prompt', label: 'Prompt', type: 'textarea', placeholder: 'The customer asked about: {{topic}}' },
    { key: 'systemPrompt', label: 'System prompt', type: 'textarea', placeholder: 'You are a friendly assistant…' },
    { key: 'saveAs', label: 'Save response to', type: 'text', placeholder: 'flow.llmResponse' },
    { key: 'model', label: 'Model override', type: 'text', placeholder: 'Leave empty to use bot default' },
  ],
  handover: HANDOVER_FIELDS,
  search_knowledge: [
    { key: 'query', label: 'Search query', type: 'text', placeholder: '{{user.message}}' },
    { key: 'topK', label: 'Top K results', type: 'number', placeholder: '3' },
    { key: 'saveAs', label: 'Save results to', type: 'text', placeholder: 'flow.kbResults' },
  ],
  classify_intent: [
    { key: 'variable', label: 'Save intent to', type: 'text', placeholder: 'intent' },
    { key: 'categories', label: 'Categories for this bot (JSON array)', type: 'textarea', placeholder: '["plans","hours","book","other"]' },
  ],
  create_ticket: [
    { key: 'subject', label: 'Subject', type: 'text', placeholder: 'Return request: {{return_reason}}' },
    { key: 'priority', label: 'Priority', type: 'text', placeholder: 'medium' },
    { key: 'team', label: 'Team', type: 'text', placeholder: 'returns' },
  ],
  trigger_start: [
    { key: 'event', label: 'Trigger event', type: 'text', placeholder: 'conversation.started' },
  ],
  knowledge_search: [
    { key: 'query', label: 'Search query', type: 'text', placeholder: '{{user.message}}' },
    { key: 'topK', label: 'Top K results', type: 'number', placeholder: '3' },
    { key: 'saveAs', label: 'Save results to', type: 'text', placeholder: 'flow.kbResults' },
  ],
  execute_flow: [
    { key: 'flowId', label: 'Target flow ID', type: 'text', placeholder: 'flow-cuid' },
  ],
  buttons: [
    { key: 'text', label: 'Message text', type: 'textarea', placeholder: 'Please choose an option:' },
    { key: 'buttons', label: 'Buttons (JSON array)', type: 'textarea', placeholder: '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]' },
  ],
  quick_replies: [
    { key: 'text', label: 'Message text', type: 'text', placeholder: 'How can I help?' },
    { key: 'replies', label: 'Quick replies (comma-separated)', type: 'text', placeholder: 'Track order, Cancel order, Talk to agent' },
  ],
  carousel: [
    { key: 'cards', label: 'Cards (JSON array)', type: 'textarea', placeholder: '[{"title":"Card 1","subtitle":"Subtitle","image":"url"}]' },
  ],
}

export function NodeConfigPanel({ node, issues = [], onUpdate, onDelete, onClose }: NodeConfigPanelProps) {
  const [labelEdit, setLabelEdit] = useState<string | null>(null)

  if (!node) return null

  const data = node!.data as unknown as FlowNodeData
  const def = NODE_DEFINITIONS[data.kind]
  const fields = CONFIG_FIELDS[data.kind] ?? []

  // Unknown node kind — show a safe fallback instead of crashing
  if (!def) {
    return (
      <div className="flex w-[280px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <span className="text-sm font-semibold text-[var(--text-primary)]">Unknown node</span>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-xs text-[var(--text-muted)]">
            Node kind <code className="font-mono bg-[var(--bg-overlay)] px-1 rounded">{data.kind}</code> is not recognised by the canvas editor.
          </p>
          <p className="text-xs text-[var(--text-muted)]">ID: <span className="font-mono">{node.id.slice(0, 12)}</span></p>
        </div>
        <div className="border-t border-[var(--border)] p-3">
          <Button variant="destructive" size="sm" className="w-full" onClick={() => { onDelete(node.id); onClose() }}>
            Delete node
          </Button>
        </div>
      </div>
    )
  }

  function fieldValue(value: unknown): string {
    if (value == null) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return JSON.stringify(value, null, 2)
  }

  /** Handover steps saved before the contract used team and note. */
  function legacyValue(key: string): unknown {
    if (data.kind !== 'handover' && data.kind !== 'transfer_agent') return undefined
    if (key === 'queue') return data.config?.['team']
    if (key === 'reason') return data.config?.['note']
    return undefined
  }

  function selectedOption(key: string, value: string): string {
    if (key === 'priority') return handoverPriority(value) ?? value
    if (key === 'context') return handoverContext(value) ?? value
    return value
  }

  function updateConfig(key: string, value: string) {
    if (!node) return
    onUpdate(node.id, {
      config: { ...(data.config ?? {}), [key]: value },
    })
  }

  const mode = stepMode(data.kind, data.config)

  function setMode(next: 'deterministic' | 'ai') {
    if (!node) return
    const config: Record<string, unknown> = { ...(data.config ?? {}), mode: next }
    if (next === 'ai' && !config['maxTurns']) config['maxTurns'] = String(AI_DEFAULT_TURNS)
    onUpdate(node.id, { config })
  }

  return (
    <div className="flex w-[280px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded text-[10px]"
            style={{ background: `${def.color}20`, color: def.color }}
          >
            ●
          </div>
          {labelEdit !== null ? (
            <input
              className="bg-transparent text-sm font-semibold text-[var(--text-primary)] outline-none border-b border-[var(--border-focus)] w-full"
              value={labelEdit}
              onChange={(e) => setLabelEdit(e.target.value)}
              onBlur={() => {
                if (labelEdit.trim()) onUpdate(node.id, { label: labelEdit.trim() })
                setLabelEdit(null)
              }}
              autoFocus
            />
          ) : (
            <button
              className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
              onClick={() => setLabelEdit(data.label)}
            >
              {data.label}
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Description */}
      <div className="border-b border-[var(--border)] px-4 py-2">
        <p className="text-xs text-[var(--text-muted)]">{def.description}</p>
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">ID: <span className="font-mono">{node.id.slice(0, 12)}</span></p>
      </div>

      {/* Config fields */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {issues.length > 0 && (
          <ul className="space-y-1" data-testid="step-issues">
            {issues.map((issue, index) => (
              <li
                key={`${issue.code}-${index}`}
                className={`rounded px-2 py-1.5 text-[11px] ${issue.level === 'note' ? 'bg-[var(--bg-overlay)] text-[var(--text-secondary)]' : 'bg-[var(--error)]/10 text-[var(--text-primary)]'}`}
              >
                <span className="font-medium">{issue.level === 'note' ? 'Worth a look: ' : 'Fix before publishing: '}</span>
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-1" data-testid="step-mode">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Mode</span>
          {SWITCHABLE_STEP_KINDS.has(data.kind) ? (
            <div role="radiogroup" aria-label="Mode" className="grid grid-cols-2 rounded border border-[var(--border)] p-0.5 text-xs">
              {(['deterministic', 'ai'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={`rounded px-2 py-1 ${mode === value ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  {value === 'ai' ? 'AI' : 'Deterministic'}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-xs text-[var(--text-primary)]">{mode === 'ai' ? 'AI' : 'Deterministic'}</span>
          )}
          <p className="text-[10px] text-[var(--text-muted)]">
            {mode === 'ai'
              ? 'The model talks with the guest toward the goal, one question at a time, until the exit condition is met or the turn limit is reached.'
              : data.kind === 'route_topic'
                ? 'Rules decide first. The model only picks a route when no rule did.'
                : 'Runs exactly as written. No model decides here.'}
          </p>
        </div>

        {data.kind === 'route_topic' && (
          <RouterEditor config={data.config} onChange={(routes) => onUpdate(node.id, { config: { ...(data.config ?? {}), routes } })} />
        )}

        {data.kind === 'run_tool' && (
          <RunToolEditor config={data.config} onChange={(config) => onUpdate(node.id, { config })} />
        )}

        {mode === 'ai' && AI_FIELDS.map(renderField)}

        {fields.length === 0 && data.kind !== 'route_topic' && data.kind !== 'run_tool' ? (
          <p className="text-xs text-[var(--text-muted)] italic">No configuration for this node.</p>
        ) : (
          fields.map(renderField)
        )}
      </div>

      {/* Actions */}
      <div className="border-t border-[var(--border)] p-3 flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          className="flex-1"
          onClick={() => { onDelete(node.id); onClose() }}
        >
          Delete node
        </Button>
      </div>
    </div>
  )

  function renderField(field: ConfigField) {
    const val = fieldValue(data.config?.[field.key] ?? legacyValue(field.key))
    const hint = field.hint ? <p className="text-[10px] text-[var(--text-muted)]">{field.hint}</p> : null
    if (field.options) {
      const selected = selectedOption(field.key, val)
      return (
        <div key={field.key} className="flex flex-col gap-1">
          <label htmlFor={`cfg-${field.key}`} className="text-xs font-medium text-[var(--text-secondary)]">{field.label}</label>
          <select
            id={`cfg-${field.key}`}
            value={selected}
            onChange={(e) => updateConfig(field.key, e.target.value)}
            className="w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none"
          >
            {!field.options.some((option) => option.value === selected) && <option value={selected}>{selected} (not allowed)</option>}
            {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {hint}
        </div>
      )
    }
    if (field.type === 'textarea') {
      return (
        <div key={field.key} className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-secondary)]">{field.label}</label>
          <textarea
            rows={3}
            placeholder={field.placeholder}
            value={val}
            onChange={(e) => updateConfig(field.key, e.target.value)}
            className="w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none resize-none"
          />
          {hint}
        </div>
      )
    }
    return (
      <div key={field.key} className="flex flex-col gap-1">
        <Input
          label={field.label}
          placeholder={field.placeholder}
          value={val}
          onChange={(e) => updateConfig(field.key, e.target.value)}
        />
        {hint}
      </div>
    )
  }
}
