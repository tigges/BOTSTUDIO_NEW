import React, { useMemo, useState } from 'react'
import { Loader2, Plus, RefreshCw, Trash2, Play, CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import {
  Button, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogDescription,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@botstudio/ui'
import {
  TOOL_EFFECTS, TOOL_EFFECT_LABELS, TOOL_KIND_LABELS, TOOL_PARAM_TYPES,
  defaultToolConfig, httpConfig, toolChangesData, toolIssues, toolParametersSchema,
  type ToolDraft, type ToolKind, type ToolParameter, type ToolEffect,
} from '@botstudio/shared'
import type { ToolSummary } from '../../../lib/api'
import { ApiError } from '../../../lib/api'
import { useAuthProfiles, useRefreshTool, useSaveTool, useTestTool, useToolRuns, useWorkflows } from '../../../lib/hooks'
import { Callout, Field, JsonBlock, Select, TextArea, TextInput } from './fields'

export function blankTool(kind: ToolKind): ToolDraft {
  return {
    name: '',
    kind,
    description: '',
    parameters: kind === 'knowledge' ? [{ name: 'query', type: 'string', description: 'The question to search for', required: true }] : [],
    returns: { type: 'object', description: '' },
    effect: kind === 'workflow' ? 'side_effect' : 'read',
    config: defaultToolConfig(kind),
    authProfileId: null,
  }
}

function draftFrom(tool: ToolSummary): ToolDraft {
  return {
    name: tool.name,
    kind: tool.kind,
    description: tool.description,
    parameters: tool.parameters,
    returns: tool.returns,
    effect: tool.effect,
    config: tool.config,
    authProfileId: tool.authProfileId,
  }
}

export const EFFECT_HINT: Record<ToolEffect, string> = {
  read: 'Only looks things up. Test chats run it.',
  write: 'Creates or changes records. Test chats skip it, and the Inbox asks before running it.',
  side_effect: 'Sends or triggers something outside BotStudio. Test chats skip it, and the Inbox asks before running it.',
}

interface Props {
  open: boolean
  tool?: ToolSummary
  initial?: ToolDraft
  onClose: () => void
  onSaved?: (tool: ToolSummary) => void
}

export function ToolEditor({ open, tool, initial, onClose, onSaved }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="xl">
        {open && <EditorBody key={tool?.id ?? 'new'} tool={tool} initial={initial} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function EditorBody({ tool, initial, onClose, onSaved }: Omit<Props, 'open'>) {
  const [draft, setDraft] = useState<ToolDraft>(() => (tool ? draftFrom(tool) : initial ?? blankTool('http')))
  const [tab, setTab] = useState('definition')
  const [serverError, setServerError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const save = useSaveTool()
  const issues = useMemo(() => toolIssues(draft), [draft])
  const issueFor = (field: string) => (touched ? issues.find((issue) => issue.field === field)?.message : undefined)
  const dirty = !tool || JSON.stringify(draftFrom(tool)) !== JSON.stringify(draft)

  function patch(next: Partial<ToolDraft>) {
    setDraft((current) => ({ ...current, ...next }))
    setServerError(null)
  }

  async function handleSave() {
    setTouched(true)
    if (issues.length > 0) return
    try {
      const saved = await save.mutateAsync({ id: tool?.id, body: { ...draft, authProfileId: draft.authProfileId ?? null } })
      onSaved?.(saved)
      if (!tool) onClose()
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'The tool could not be saved. Try again.')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{tool ? <span className="font-mono">{tool.name}</span> : `New ${TOOL_KIND_LABELS[draft.kind]} tool`}</DialogTitle>
        <DialogDescription>
          {TOOL_KIND_LABELS[draft.kind]} tool. The bot and people in the Inbox run it from the same Tools list.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="definition">Definition</TabsTrigger>
            <TabsTrigger value="connection">Connection</TabsTrigger>
            <TabsTrigger value="schema">JSON Schema</TabsTrigger>
            <TabsTrigger value="testing" disabled={!tool}>Testing</TabsTrigger>
          </TabsList>

          <TabsContent value="definition" className="mt-4 space-y-4">
            <Definition draft={draft} patch={patch} issueFor={issueFor} />
          </TabsContent>
          <TabsContent value="connection" className="mt-4 space-y-4">
            <Connection draft={draft} patch={patch} issueFor={issueFor} tool={tool} />
          </TabsContent>
          <TabsContent value="schema" className="mt-4 space-y-3">
            <p className="text-xs text-[var(--text-muted)]">What the model sees when it decides whether and how to call this tool. Generated from the parameters.</p>
            <JsonBlock value={{ name: draft.name, description: draft.description, parameters: toolParametersSchema(draft.parameters) }} />
            <p className="text-xs text-[var(--text-muted)]">Returns: <span className="font-mono">{draft.returns.type}</span>{draft.returns.description ? ` — ${draft.returns.description}` : ''}</p>
          </TabsContent>
          <TabsContent value="testing" className="mt-4 space-y-4">
            {tool && <Testing tool={tool} dirty={dirty} />}
          </TabsContent>
        </Tabs>
      </DialogBody>
      <DialogFooter className="justify-between">
        <div className="min-w-0 flex-1 text-[11px]">
          {serverError ? <span className="text-[var(--error)]">{serverError}</span>
            : touched && issues.length > 0 ? <span className="text-[var(--error)]">{issues[0]!.message}{issues.length > 1 ? ` (${issues.length - 1} more)` : ''}</span>
            : issues.length > 0 ? <span className="text-[var(--text-muted)]">{issues.length} {issues.length === 1 ? 'thing' : 'things'} to fix before saving.</span>
            : null}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>{tool ? 'Close' : 'Cancel'}</Button>
          <Button size="sm" onClick={handleSave} disabled={save.isPending || (Boolean(tool) && !dirty)}>
            {save.isPending && <Loader2 size={12} className="mr-1 animate-spin" />}
            {tool ? 'Save changes' : 'Create tool'}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

type Patch = (next: Partial<ToolDraft>) => void
type IssueFor = (field: string) => string | undefined

function Definition({ draft, patch, issueFor }: { draft: ToolDraft; patch: Patch; issueFor: IssueFor }) {
  function setParam(index: number, next: Partial<ToolParameter>) {
    patch({ parameters: draft.parameters.map((param, i) => (i === index ? { ...param, ...next } : param)) })
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name" htmlFor="tool-name" hint="Lowercase with underscores, for example lookup_order." error={issueFor('name')}>
          <TextInput id="tool-name" className="font-mono" value={draft.name} placeholder="lookup_order" onChange={(e) => patch({ name: e.target.value.trim() })} />
        </Field>
        <Field label="Effect" htmlFor="tool-effect" hint={EFFECT_HINT[draft.effect]}>
          <Select id="tool-effect" value={draft.effect} onChange={(e) => patch({ effect: e.target.value as ToolEffect })}>
            {TOOL_EFFECTS.map((effect) => <option key={effect} value={effect}>{TOOL_EFFECT_LABELS[effect]}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Description for the bot" htmlFor="tool-description" hint="The bot reads this to decide when to use the tool. Say what it does and when it is the right one." error={issueFor('description')}>
        <TextArea id="tool-description" rows={3} value={draft.description} placeholder="Looks up an order by its number and returns the status and delivery date. Use it when a guest asks where their order is." onChange={(e) => patch({ description: e.target.value })} />
      </Field>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Parameters</span>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => patch({ parameters: [...draft.parameters, { name: '', type: 'string', description: '', required: true }] })}>
            <Plus size={12} /> Add parameter
          </Button>
        </div>
        {issueFor('parameters') && <p className="text-[11px] text-[var(--error)]">{issueFor('parameters')}</p>}
        {draft.parameters.length === 0 ? (
          <p className="text-[11px] text-[var(--text-muted)]">No parameters. The tool runs with no input.</p>
        ) : (
          <div className="space-y-2">
            {draft.parameters.map((param, index) => (
              <div key={index} className="grid grid-cols-[1fr_110px_1.6fr_auto_auto] items-start gap-2 rounded border border-[var(--border)] p-2">
                <div>
                  <TextInput aria-label={`Parameter ${index + 1} name`} className="font-mono" value={param.name} placeholder="order_number" onChange={(e) => setParam(index, { name: e.target.value.trim() })} />
                  {issueFor(`parameters.${index}.name`) && <p className="mt-1 text-[10px] text-[var(--error)]">{issueFor(`parameters.${index}.name`)}</p>}
                </div>
                <Select aria-label={`Parameter ${index + 1} type`} value={param.type} onChange={(e) => setParam(index, { type: e.target.value as ToolParameter['type'] })}>
                  {TOOL_PARAM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </Select>
                <div className="space-y-1">
                  <TextInput aria-label={`Parameter ${index + 1} description`} value={param.description} placeholder="What the bot should pass" onChange={(e) => setParam(index, { description: e.target.value })} />
                  <TextInput aria-label={`Parameter ${index + 1} allowed values`} value={(param.enum ?? []).join(', ')} placeholder="Allowed values, comma separated (optional)" onChange={(e) => {
                    const values = e.target.value.split(',').map((v) => v.trim()).filter(Boolean)
                    setParam(index, { enum: values.length ? values : undefined })
                  }} />
                  {issueFor(`parameters.${index}.description`) && <p className="text-[10px] text-[var(--error)]">{issueFor(`parameters.${index}.description`)}</p>}
                </div>
                <label className="flex items-center gap-1 pt-2 text-[11px] text-[var(--text-secondary)]">
                  <input type="checkbox" checked={param.required} onChange={(e) => setParam(index, { required: e.target.checked })} /> Required
                </label>
                <button type="button" aria-label={`Remove parameter ${param.name || index + 1}`} className="pt-2 text-[var(--text-muted)] hover:text-[var(--error)]" onClick={() => patch({ parameters: draft.parameters.filter((_, i) => i !== index) })}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-[140px_1fr] gap-4">
        <Field label="Returns" htmlFor="tool-returns">
          <Select id="tool-returns" value={draft.returns.type} onChange={(e) => patch({ returns: { ...draft.returns, type: e.target.value as ToolParameter['type'] } })}>
            {TOOL_PARAM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </Select>
        </Field>
        <Field label="What comes back" htmlFor="tool-returns-description">
          <TextInput id="tool-returns-description" value={draft.returns.description} placeholder="Order status and delivery date" onChange={(e) => patch({ returns: { ...draft.returns, description: e.target.value } })} />
        </Field>
      </div>
    </>
  )
}

function AuthProfilePicker({ value, onChange }: { value: string | null | undefined; onChange: (id: string | null) => void }) {
  const { data: profiles = [], isLoading } = useAuthProfiles()
  return (
    <Field label="Auth Profile" htmlFor="tool-auth" hint="Credentials live only in Auth Profiles, never on the tool. Manage them on the Auth Profiles tab.">
      <Select id="tool-auth" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} disabled={isLoading}>
        <option value="">No credentials</option>
        {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </Select>
    </Field>
  )
}

function Connection({ draft, patch, issueFor, tool }: { draft: ToolDraft; patch: Patch; issueFor: IssueFor; tool?: ToolSummary }) {
  const setConfig = (next: Record<string, unknown>) => patch({ config: { ...draft.config, ...next } })
  if (draft.kind === 'http') return <HttpConnection draft={draft} setConfig={setConfig} patch={patch} issueFor={issueFor} />
  if (draft.kind === 'function') {
    return (
      <>
        <Callout>Functions run JavaScript with no network, file or environment access, for up to 5 seconds. To call an API, use an HTTP tool.</Callout>
        <Field label="Code" htmlFor="tool-code" hint="Define async function main(args) and return the result. args holds the parameters." error={issueFor('config.code')}>
          <TextArea id="tool-code" rows={12} className="font-mono" spellCheck={false} value={String(draft.config['code'] ?? '')} onChange={(e) => setConfig({ code: e.target.value })} />
        </Field>
        <Field label="Time limit (ms)" htmlFor="tool-fn-timeout">
          <TextInput id="tool-fn-timeout" type="number" min={100} max={5000} value={String(draft.config['timeoutMs'] ?? 2000)} onChange={(e) => setConfig({ timeoutMs: Number(e.target.value) })} />
        </Field>
      </>
    )
  }
  if (draft.kind === 'mcp') return <McpConnection draft={draft} setConfig={setConfig} patch={patch} issueFor={issueFor} tool={tool} />
  if (draft.kind === 'knowledge') {
    return (
      <>
        <Callout>Searches this bot’s knowledge sources with the <span className="font-mono">query</span> parameter and returns the closest passages.</Callout>
        <Field label="Passages to return" htmlFor="tool-topk">
          <TextInput id="tool-topk" type="number" min={1} max={10} value={String(draft.config['topK'] ?? 4)} onChange={(e) => setConfig({ topK: Number(e.target.value) })} />
        </Field>
      </>
    )
  }
  return <WorkflowConnection draft={draft} setConfig={setConfig} issueFor={issueFor} />
}

function HttpConnection({ draft, setConfig, patch, issueFor }: { draft: ToolDraft; setConfig: (next: Record<string, unknown>) => void; patch: Patch; issueFor: IssueFor }) {
  const http = httpConfig(draft.config)
  const headers = Object.entries(http.headers)
  const headerIssues = Object.keys(http.headers).map((name) => issueFor(`config.headers.${name}`)).filter(Boolean)
  return (
    <>
      <div className="grid grid-cols-[110px_1fr] gap-2">
        <Field label="Method" htmlFor="tool-method">
          <Select id="tool-method" value={http.method} onChange={(e) => setConfig({ method: e.target.value })}>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => <option key={method}>{method}</option>)}
          </Select>
        </Field>
        <Field label="URL" htmlFor="tool-url" hint="Use {{parameter}} to fill values in. They are URL-encoded." error={issueFor('config.url')}>
          <TextInput id="tool-url" className="font-mono" value={http.url} placeholder="https://api.example.com/orders/{{order_number}}" onChange={(e) => setConfig({ url: e.target.value })} />
        </Field>
      </div>
      <AuthProfilePicker value={draft.authProfileId} onChange={(id) => patch({ authProfileId: id })} />
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Headers</span>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setConfig({ headers: { ...http.headers, '': '' } })}><Plus size={12} /> Add header</Button>
        </div>
        {headers.length === 0 && <p className="text-[11px] text-[var(--text-muted)]">No extra headers. Credentials come from the Auth Profile.</p>}
        {headers.map(([name, value], index) => (
          <div key={index} className="grid grid-cols-[1fr_1.5fr_auto] gap-2">
            <TextInput aria-label={`Header ${index + 1} name`} className="font-mono" value={name} placeholder="Accept-Language" onChange={(e) => {
              const next = headers.map(([k, v], i) => (i === index ? [e.target.value, v] : [k, v]))
              setConfig({ headers: Object.fromEntries(next) })
            }} />
            <TextInput aria-label={`Header ${index + 1} value`} className="font-mono" value={value} onChange={(e) => setConfig({ headers: { ...http.headers, [name]: e.target.value } })} />
            <button type="button" aria-label={`Remove header ${name}`} className="text-[var(--text-muted)] hover:text-[var(--error)]" onClick={() => setConfig({ headers: Object.fromEntries(headers.filter((_, i) => i !== index)) })}><Trash2 size={13} /></button>
          </div>
        ))}
        {headerIssues.map((message) => <p key={message} className="text-[11px] text-[var(--error)]">{message}</p>)}
      </div>
      {http.method !== 'GET' && http.method !== 'DELETE' && (
        <Field label="Body (JSON)" htmlFor="tool-body" hint="Leave empty to send the arguments as JSON. {{parameter}} keeps its type when it stands alone." error={issueFor('config.body')}>
          <TextArea id="tool-body" rows={5} className="font-mono" spellCheck={false} value={http.body} placeholder={'{"order": "{{order_number}}", "notify": {{notify}}}'} onChange={(e) => setConfig({ body: e.target.value })} />
        </Field>
      )}
      {issueFor('config') && <p className="text-[11px] text-[var(--error)]">{issueFor('config')}</p>}
      <details className="rounded border border-[var(--border)] px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-[var(--text-secondary)]">Advanced: timeout, retries, circuit breaker, idempotency</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Timeout (seconds)" htmlFor="tool-timeout" hint="Default 30, up to 120.">
            <TextInput id="tool-timeout" type="number" min={1} max={120} value={String(Math.round(http.timeoutMs / 1000))} onChange={(e) => setConfig({ timeoutMs: Number(e.target.value) * 1000 })} />
          </Field>
          <Field label="Retries" htmlFor="tool-retries" hint="Only for tools that read data, or that send an idempotency header.">
            <TextInput id="tool-retries" type="number" min={0} max={5} value={String(http.retries)} onChange={(e) => setConfig({ retries: Number(e.target.value) })} />
          </Field>
          <Field label="Pause after failures in a row" htmlFor="tool-breaker" hint="Circuit breaker. Default 5.">
            <TextInput id="tool-breaker" type="number" min={1} max={50} value={String(http.circuitBreaker.failures)} onChange={(e) => setConfig({ circuitBreaker: { ...http.circuitBreaker, failures: Number(e.target.value) } })} />
          </Field>
          <Field label="Pause for (seconds)" htmlFor="tool-breaker-reset" hint="Default 60.">
            <TextInput id="tool-breaker-reset" type="number" min={5} max={3600} value={String(http.circuitBreaker.resetSeconds)} onChange={(e) => setConfig({ circuitBreaker: { ...http.circuitBreaker, resetSeconds: Number(e.target.value) } })} />
          </Field>
          <Field label="Idempotency header" htmlFor="tool-idem" hint="Sent with one key per call, the same on every retry. Empty turns it off.">
            <TextInput id="tool-idem" className="font-mono" value={http.idempotencyHeader} onChange={(e) => setConfig({ idempotencyHeader: e.target.value.trim() })} />
          </Field>
        </div>
      </details>
    </>
  )
}

function McpConnection({ draft, setConfig, patch, issueFor, tool }: { draft: ToolDraft; setConfig: (next: Record<string, unknown>) => void; patch: Patch; issueFor: IssueFor; tool?: ToolSummary }) {
  const refresh = useRefreshTool()
  const fetchedAt = typeof draft.config['fetchedAt'] === 'string' ? new Date(draft.config['fetchedAt']) : null
  return (
    <>
      <Callout>MCP tool definitions are fetched when you add the tool and when you click Refresh. They do not update on their own.</Callout>
      <Field label="MCP server" htmlFor="tool-mcp-url" error={issueFor('config.serverUrl')}>
        <TextInput id="tool-mcp-url" className="font-mono" value={String(draft.config['serverUrl'] ?? '')} onChange={(e) => setConfig({ serverUrl: e.target.value })} />
      </Field>
      <Field label="Tool on the server" htmlFor="tool-mcp-name" error={issueFor('config.toolName')}>
        <TextInput id="tool-mcp-name" className="font-mono" value={String(draft.config['toolName'] ?? '')} readOnly />
      </Field>
      <AuthProfilePicker value={draft.authProfileId} onChange={(id) => patch({ authProfileId: id })} />
      <div className="flex items-center justify-between rounded border border-[var(--border)] px-3 py-2">
        <span className="text-[11px] text-[var(--text-muted)]">{fetchedAt ? `Definition fetched ${fetchedAt.toLocaleString()}` : 'Definition not fetched yet.'}</span>
        <Button variant="secondary" size="sm" className="gap-1" disabled={!tool || refresh.isPending} onClick={() => tool && refresh.mutate(tool.id, { onSuccess: (next) => patch({ parameters: next.parameters, config: next.config }) })}>
          {refresh.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh definition
        </Button>
      </div>
      {refresh.isError && <p className="text-[11px] text-[var(--error)]">{refresh.error instanceof ApiError ? refresh.error.message : 'The server could not be reached.'}</p>}
    </>
  )
}

function WorkflowConnection({ draft, setConfig, issueFor }: { draft: ToolDraft; setConfig: (next: Record<string, unknown>) => void; issueFor: IssueFor }) {
  const { data: workflows = [], isLoading } = useWorkflows()
  return (
    <>
      <Callout>Runs a workflow’s actions straight away, without waiting for its trigger. Paused workflows do not run.</Callout>
      <Field label="Workflow" htmlFor="tool-workflow" error={issueFor('config.workflowId')}>
        <Select id="tool-workflow" value={String(draft.config['workflowId'] ?? '')} onChange={(e) => setConfig({ workflowId: e.target.value })} disabled={isLoading}>
          <option value="">Choose a workflow</option>
          {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}{workflow.status === 'paused' ? ' (paused)' : ''}</option>)}
        </Select>
      </Field>
    </>
  )
}

function Testing({ tool, dirty }: { tool: ToolSummary; dirty: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const test = useTestTool()
  const runs = useToolRuns(tool.id)
  const changes = toolChangesData(tool.effect)

  function args(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const param of tool.parameters) {
      const raw = values[param.name]
      if (raw !== undefined && raw !== '') out[param.name] = raw
    }
    return out
  }

  const result = test.data
  return (
    <>
      {dirty && <Callout tone="warning">You have unsaved changes. Tests run the saved version of this tool.</Callout>}
      {changes && (
        <Callout tone="warning">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            This tool {tool.effect === 'write' ? 'changes data' : 'has a side effect'}. A test here runs it for real.
          </label>
        </Callout>
      )}
      {tool.parameters.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">This tool takes no input.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {tool.parameters.map((param) => (
            <Field key={param.name} label={`${param.name}${param.required ? ' *' : ''}`} htmlFor={`test-${param.name}`} hint={`${param.type}${param.description ? ` — ${param.description}` : ''}`}>
              {param.enum?.length ? (
                <Select id={`test-${param.name}`} value={values[param.name] ?? ''} onChange={(e) => setValues({ ...values, [param.name]: e.target.value })}>
                  <option value="">—</option>
                  {param.enum.map((value) => <option key={value}>{value}</option>)}
                </Select>
              ) : (
                <TextInput id={`test-${param.name}`} className="font-mono" value={values[param.name] ?? ''} onChange={(e) => setValues({ ...values, [param.name]: e.target.value })} />
              )}
            </Field>
          ))}
        </div>
      )}
      <Button size="sm" className="gap-1" disabled={test.isPending || (changes && !confirmed)} onClick={() => test.mutate({ id: tool.id, args: args() })}>
        {test.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run test
      </Button>
      {test.isError && <Callout tone="error">{test.error instanceof ApiError ? test.error.message : 'The test could not run. Try again.'}</Callout>}
      {result && (
        <div className="space-y-2" data-testid="tool-test-result">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={result.ok ? 'success' : 'error'}>{result.ok ? 'Succeeded' : 'Failed'}</Badge>
            {result.status !== undefined && <span className="text-[var(--text-muted)]">HTTP {result.status}</span>}
            <span className="text-[var(--text-muted)]">{result.durationMs} ms</span>
            {result.attempts > 1 && <span className="text-[var(--text-muted)]">{result.attempts} attempts</span>}
          </div>
          {result.error && <Callout tone="error">{result.error}</Callout>}
          <JsonBlock value={result.output} />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs font-medium text-[var(--text-secondary)]">Recent runs</p>
        {runs.isLoading ? <p className="text-[11px] text-[var(--text-muted)]">Loading runs…</p>
          : runs.isError ? <p className="text-[11px] text-[var(--error)]">Runs could not be loaded. <button className="underline" onClick={() => runs.refetch()}>Retry</button></p>
          : (runs.data ?? []).length === 0 ? <p className="text-[11px] text-[var(--text-muted)]">No runs yet.</p>
          : (
            <ul className="divide-y divide-[var(--border)] rounded border border-[var(--border)]">
              {(runs.data ?? []).slice(0, 8).map((run) => (
                <li key={run.id} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                  {run.ok ? <CheckCircle2 size={12} className="text-[var(--success)]" /> : run.source === 'test_chat' ? <MinusCircle size={12} className="text-[var(--text-muted)]" /> : <XCircle size={12} className="text-[var(--error)]" />}
                  <span className="w-16 text-[var(--text-muted)]">{SOURCE_LABELS[run.source] ?? run.source}</span>
                  <span className="flex-1 truncate font-mono text-[var(--text-secondary)]">{JSON.stringify(run.input)}</span>
                  <span className="text-[var(--text-muted)]">{run.durationMs} ms</span>
                  <span className="text-[var(--text-muted)]">{new Date(run.createdAt).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </>
  )
}

const SOURCE_LABELS: Record<string, string> = { bot: 'Bot', inbox: 'Inbox', console: 'Test', test_chat: 'Test chat', eval: 'Eval' }
