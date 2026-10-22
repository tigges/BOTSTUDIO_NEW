import React, { useState } from 'react'
import { Loader2, Download } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@botstudio/ui'
import { TOOL_EFFECTS, TOOL_EFFECT_LABELS, type ToolEffect } from '@botstudio/shared'
import { ApiError } from '../../../lib/api'
import { useAuthProfiles, useMcpDiscover, useMcpImport } from '../../../lib/hooks'
import { Callout, Field, Select, TextInput } from './fields'
import { EFFECT_HINT } from './ToolEditor'

export function McpImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [serverUrl, setServerUrl] = useState('')
  const [authProfileId, setAuthProfileId] = useState<string>('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [effect, setEffect] = useState<ToolEffect>('read')
  const { data: profiles = [] } = useAuthProfiles()
  const discover = useMcpDiscover()
  const add = useMcpImport()

  function reset() {
    setServerUrl(''); setAuthProfileId(''); setPicked(new Set()); setEffect('read'); discover.reset(); add.reset()
  }

  function close() { reset(); onClose() }

  const remote = discover.data?.tools ?? []
  const result = add.data
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add tools from an MCP server</DialogTitle>
          <DialogDescription>Each tool you pick becomes its own entry in the Tools list, with its own description and effect.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Callout>Definitions are fetched now, at configuration time. Later changes on the server reach BotStudio only when you click Refresh on the tool.</Callout>
          <div className="grid grid-cols-[1fr_200px] gap-3">
            <Field label="Server URL" htmlFor="mcp-url" hint="Streamable HTTP endpoint, for example https://mcp.example.com/mcp">
              <TextInput id="mcp-url" className="font-mono" value={serverUrl} onChange={(e) => setServerUrl(e.target.value.trim())} placeholder="https://mcp.example.com/mcp" />
            </Field>
            <Field label="Auth Profile" htmlFor="mcp-auth">
              <Select id="mcp-auth" value={authProfileId} onChange={(e) => setAuthProfileId(e.target.value)}>
                <option value="">No credentials</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </Select>
            </Field>
          </div>
          <Button variant="secondary" size="sm" className="gap-1" disabled={!serverUrl || discover.isPending} onClick={() => { setPicked(new Set()); discover.mutate({ serverUrl, authProfileId: authProfileId || null }) }}>
            {discover.isPending ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Fetch tools
          </Button>
          {discover.isError && <Callout tone="error">{discover.error instanceof ApiError ? discover.error.message : 'The server could not be reached.'}</Callout>}
          {discover.isSuccess && remote.length === 0 && <Callout>The server answered but offers no tools.</Callout>}
          {remote.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--text-secondary)]">{remote.length} tools on this server</p>
              <ul className="max-h-64 divide-y divide-[var(--border)] overflow-auto rounded border border-[var(--border)]">
                {remote.map((tool) => (
                  <li key={tool.name} className="flex items-start gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Add ${tool.name}`}
                      className="mt-0.5"
                      checked={picked.has(tool.name)}
                      onChange={(e) => {
                        const next = new Set(picked)
                        if (e.target.checked) next.add(tool.name); else next.delete(tool.name)
                        setPicked(next)
                      }}
                    />
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-[var(--text-primary)]">{tool.name}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{tool.description || 'No description from the server.'}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{tool.parameters.map((param) => `${param.name}${param.required ? '*' : ''}: ${param.type}`).join(', ') || 'No parameters'}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Field label="Effect of the tools you add" htmlFor="mcp-effect" hint={EFFECT_HINT[effect]}>
                <Select id="mcp-effect" value={effect} onChange={(e) => setEffect(e.target.value as ToolEffect)}>
                  {TOOL_EFFECTS.map((value) => <option key={value} value={value}>{TOOL_EFFECT_LABELS[value]}</option>)}
                </Select>
              </Field>
            </div>
          )}
          {result && (
            <Callout tone={result.skipped.length ? 'warning' : 'success'}>
              Added {result.created.length} {result.created.length === 1 ? 'tool' : 'tools'}.
              {result.skipped.length > 0 && <> Not added: {result.skipped.join(' ')}</>}
            </Callout>
          )}
          {add.isError && <Callout tone="error">{add.error instanceof ApiError ? add.error.message : 'The tools could not be added.'}</Callout>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close}>{result ? 'Done' : 'Cancel'}</Button>
          <Button size="sm" disabled={picked.size === 0 || add.isPending} onClick={() => add.mutate({ serverUrl, authProfileId: authProfileId || null, toolNames: [...picked], effect })}>
            {add.isPending && <Loader2 size={12} className="mr-1 animate-spin" />}
            Add {picked.size || ''} {picked.size === 1 ? 'tool' : 'tools'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
