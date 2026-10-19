import React from 'react'
import { Link } from '@tanstack/react-router'
import { TOOL_EFFECT_LABELS, TOOL_KIND_LABELS } from '@ybot/shared'
import { useTools } from '../../lib/hooks'

interface RunToolEditorProps {
  config: Record<string, unknown> | undefined
  onChange: (config: Record<string, unknown>) => void
}

const inputClass = 'w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none'

export function RunToolEditor({ config = {}, onChange }: RunToolEditorProps) {
  const { data: tools, isLoading, isError, refetch } = useTools()
  const toolId = String(config['toolId'] ?? '')
  const tool = (tools ?? []).find((item) => item.id === toolId)
  const args = (config['args'] && typeof config['args'] === 'object' ? config['args'] : {}) as Record<string, string>

  function choose(id: string) {
    const next = (tools ?? []).find((item) => item.id === id)
    const kept: Record<string, string> = {}
    for (const param of next?.parameters ?? []) if (args[param.name] !== undefined) kept[param.name] = args[param.name]!
    onChange({ ...config, toolId: id, toolName: next?.name ?? '', args: kept })
  }

  function setArg(name: string, value: string) {
    onChange({ ...config, args: { ...args, [name]: value } })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="run-tool-editor">
      <div className="flex flex-col gap-1">
        <label htmlFor="cfg-toolId" className="text-xs font-medium text-[var(--text-secondary)]">Tool</label>
        {isError ? (
          <p className="text-[11px] text-[var(--error)]">
            The Tools list did not load. <button type="button" className="underline" onClick={() => void refetch()}>Try again</button>
          </p>
        ) : (
          <select id="cfg-toolId" value={toolId} onChange={(e) => choose(e.target.value)} className={inputClass} disabled={isLoading}>
            <option value="">{isLoading ? 'Loading tools…' : 'Choose a tool'}</option>
            {toolId && !tool && !isLoading && <option value={toolId}>{String(config['toolName'] || 'Removed tool')} (no longer in Tools)</option>}
            {(tools ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.name} · {TOOL_KIND_LABELS[item.kind]}</option>
            ))}
          </select>
        )}
        {!isLoading && !isError && (tools ?? []).length === 0 && (
          <p className="text-[10px] text-[var(--text-muted)]">
            No tools yet. <Link to="/build/tools" className="underline">Add one in Tools</Link>.
          </p>
        )}
        {tool && (
          <p className="text-[10px] text-[var(--text-muted)]">
            {tool.description} · {TOOL_EFFECT_LABELS[tool.effect]}
            {tool.effect !== 'read' && ' · Skipped in Test chat so nothing changes.'}
          </p>
        )}
      </div>

      {tool && tool.parameters.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Inputs</span>
          {tool.parameters.map((param) => (
            <div key={param.name} className="flex flex-col gap-1">
              <label htmlFor={`arg-${param.name}`} className="text-[11px] text-[var(--text-secondary)]">
                {param.name}{param.required ? ' *' : ''} <span className="text-[var(--text-muted)]">({param.type})</span>
              </label>
              <input
                id={`arg-${param.name}`}
                className={inputClass}
                placeholder={param.enum?.length ? param.enum.join(' | ') : `{{${param.name}}}`}
                value={args[param.name] ?? ''}
                onChange={(e) => setArg(param.name, e.target.value)}
              />
              {param.description && <p className="text-[10px] text-[var(--text-muted)]">{param.description}</p>}
            </div>
          ))}
          <p className="text-[10px] text-[var(--text-muted)]">Use {'{{variable}}'} to pass an answer from the chat.</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="cfg-saveAs" className="text-xs font-medium text-[var(--text-secondary)]">Save result to</label>
        <input id="cfg-saveAs" className={inputClass} placeholder="tool_result" value={String(config['saveAs'] ?? '')} onChange={(e) => onChange({ ...config, saveAs: e.target.value })} />
        <p className="text-[10px] text-[var(--text-muted)]">The step follows Success when the tool worked and Error when it failed. tool_error holds the reason.</p>
      </div>
    </div>
  )
}
