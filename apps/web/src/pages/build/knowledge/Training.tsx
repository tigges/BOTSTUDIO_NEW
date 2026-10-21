import React, { useState } from 'react'
import {
  Play, CheckCircle, Clock, AlertCircle,
  Cpu, TrendingUp, RefreshCw, Info,
} from 'lucide-react'
import { Button, Badge, Card, CardHeader, CardTitle } from '@ybot/ui'
import { SubNav } from '../../../components/SubNav'
import { KNOWLEDGE_SUBNAV } from './subnav'
import { cn } from '@ybot/ui'
import { useTraining, useSaveTraining, useTrainingRuns } from '../../../lib/hooks'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../../../store/app'


// ── Model catalogue ────────────────────────────────────────────────────────
const MODEL_GROUPS: Array<{
  label: string
  envVar: string
  signupUrl?: string
  free?: boolean
  models: Array<{ value: string; label: string; note?: string }>
}> = [
  {
    label: 'Google Gemini',
    envVar: 'GEMINI_API_KEY',
    signupUrl: 'https://aistudio.google.com',
    free: true,
    models: [
      { value: 'gemini-flash-latest',      label: 'Gemini Flash',      note: 'Recommended default — fast, capable, free tier. Always the current Flash' },
      { value: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite', note: 'Cheapest and fastest, free tier' },
    ],
  },
  {
    label: 'Anthropic Claude',
    envVar: 'ANTHROPIC_API_KEY',
    signupUrl: 'https://console.anthropic.com',
    models: [
      { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Best reasoning; also drafts website imports' },
      { value: 'claude-haiku-5-5',  label: 'Claude Haiku 5.5',  note: 'Fast and cheap' },
    ],
  },
  {
    label: 'Local (Ollama)',
    envVar: 'OLLAMA_BASE_URL',
    signupUrl: 'https://ollama.com',
    free: true,
    models: [
      { value: 'ollama/llama3.2', label: 'Llama 3.2 (local)', note: 'Runs on your own server, no API key' },
      { value: 'ollama/mistral',  label: 'Mistral (local)',   note: 'Lightweight option' },
    ],
  },
  {
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    signupUrl: 'https://platform.openai.com',
    models: [
      { value: 'gpt-4o',      label: 'GPT-4o',      note: 'Best quality' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini', note: 'Cost-effective' },
    ],
  },
  {
    label: 'Groq',
    envVar: 'GROQ_API_KEY',
    signupUrl: 'https://console.groq.com',
    models: [
      { value: 'groq/llama-3.3-70b-versatile', label: 'Llama 3.3 70B', note: 'Needs a Groq account with API access' },
    ],
  },
]

const MODEL_TO_GROUP: Record<string, (typeof MODEL_GROUPS)[number]> = {}
MODEL_GROUPS.forEach((g) => g.models.forEach((m) => { MODEL_TO_GROUP[m.value] = g }))

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function durationLabel(ms: number) {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

export function TrainingPage() {
  const { data: config } = useTraining()
  const saveTraining = useSaveTraining()
  const { data: trainingRuns = [] } = useTrainingRuns()
  const qc = useQueryClient()
  const selectedBotId = useAppStore((s: { selectedBotId: string | null }) => s.selectedBotId)
  const [training, setTraining] = useState(false)
  const [saved, setSaved] = useState(false)
  const [selectedModel, setSelectedModel] = useState(config?.model ?? 'gemini-flash-latest')
  const [temperature, setTemperature] = useState(String(config?.temperature ?? 0.3))
  const [systemPrompt, setSystemPrompt] = useState(config?.systemPrompt ?? 'You are a helpful customer support assistant.')

  React.useEffect(() => {
    if (config) {
      setSelectedModel(config.model ?? 'gemini-flash-latest')
      setTemperature(String(config.temperature ?? 0.3))
      setSystemPrompt(config.systemPrompt ?? '')
    }
  }, [config])

  async function handleSaveConfig() {
    try {
      await saveTraining.mutateAsync({ model: selectedModel, temperature: parseFloat(temperature), systemPrompt })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* demo mode */ }
  }

  async function handleTrain() {
    setTraining(true)
    try {
      await saveTraining.mutateAsync({ model: selectedModel, temperature: parseFloat(temperature), systemPrompt })
      // Invalidate training-runs so the new run appears immediately
      await qc.invalidateQueries({ queryKey: ['training-runs', selectedBotId] })
    } catch { /* demo mode */ }
    setTraining(false)
  }

  const latestSuccess = trainingRuns.find((r) => r.status === 'success')
  const selectedGroup = MODEL_TO_GROUP[selectedModel]
  const selectedModelMeta = selectedGroup?.models.find((m) => m.value === selectedModel)

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between px-6 pt-4 pb-0">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Knowledge</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleTrain} disabled={training} title="Saves the model settings and records a training run from your knowledge.">
            {training ? (
              <><RefreshCw size={13} className="animate-spin" /> Training…</>
            ) : (
              <><Play size={13} /> Run Training</>
            )}
          </Button>
          </div>
        </div>
        <SubNav items={KNOWLEDGE_SUBNAV} />
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* LLM Config */}
        <Card padding="none">
          <CardHeader className="px-4 pt-4">
            <div className="flex items-center gap-2">
              <Cpu size={15} className="text-[var(--accent)]" />
              <CardTitle>LLM Configuration</CardTitle>
            </div>
          </CardHeader>
          <div className="px-4 pb-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)]">Model</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none"
                >
                  {MODEL_GROUPS.map((g) => (
                    <optgroup key={g.label} label={`${g.label}${g.free ? ' (free)' : ''} · ${g.envVar}`}>
                      {g.models.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selectedGroup && (
                  <p className="mt-1.5 text-[11px] text-[var(--text-muted)] flex items-start gap-1">
                    <Info size={11} className="shrink-0 mt-0.5" />
                    <span>
                      Requires <code className="font-mono bg-[var(--bg-elevated)] px-0.5 rounded">{selectedGroup.envVar}</code>
                      {selectedGroup.free && <span className="text-[var(--success)] ml-1">· free tier available</span>}
                      {selectedGroup.signupUrl && (
                        <a href={selectedGroup.signupUrl} target="_blank" rel="noreferrer" className="ml-1 underline">
                          Get key ↗
                        </a>
                      )}
                      {selectedModelMeta?.note && <span className="ml-1 text-[var(--text-muted)]">— {selectedModelMeta.note}</span>}
                    </span>
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)]">Temperature: {temperature}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  className="mt-2 w-full accent-[var(--accent)]"
                />
                <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                  <span>Precise (0)</span><span>Creative (1)</span>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)]">System Prompt</label>
              <textarea
                rows={4}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none resize-none"
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={handleSaveConfig} disabled={saveTraining.isPending}>
                {saved ? 'Saved!' : saveTraining.isPending ? 'Saving…' : 'Save Config'}
              </Button>
            </div>
          </div>
        </Card>

        {/* Current model metrics */}
        {latestSuccess && (
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <p className="text-xs text-[var(--text-muted)]">Knowledge Sources</p>
              <p className="text-2xl font-bold text-[var(--success)] mt-1">{latestSuccess.examples}</p>
              <Badge variant="success" dot className="mt-1">Last training</Badge>
            </Card>
            <Card>
              <p className="text-xs text-[var(--text-muted)]">Intents</p>
              <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{latestSuccess.intents}</p>
            </Card>
            <Card>
              <p className="text-xs text-[var(--text-muted)]">FAQs</p>
              <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{latestSuccess.faqs}</p>
            </Card>
          </div>
        )}

        {/* Training history */}
        <Card padding="none">
          <CardHeader className="px-4 pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-[var(--accent)]" />
              <CardTitle>Training History</CardTitle>
            </div>
          </CardHeader>
          <div className="divide-y divide-[var(--border)]">
            {trainingRuns.length === 0
              ? (
                <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
                  No training runs yet. Click &ldquo;Run Training&rdquo; to sync your knowledge base.
                </div>
              )
              : trainingRuns.map((run) => {
                  const StatusIcon = run.status === 'success' ? CheckCircle : run.status === 'running' ? Clock : AlertCircle
                  return (
                    <div key={run.id} className="flex items-center gap-4 px-4 py-3">
                      <StatusIcon
                        size={15}
                        className={cn(
                          run.status === 'success' ? 'text-[var(--success)]' :
                          run.status === 'running' ? 'text-[var(--warning)] animate-spin' :
                          'text-[var(--error)]'
                        )}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={run.status === 'success' ? 'success' : run.status === 'running' ? 'warning' : 'error'}
                            dot
                          >
                            {run.status}
                          </Badge>
                          <span className="text-xs text-[var(--text-secondary)]">{run.model}</span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          {run.examples} items · {durationLabel(run.durationMs)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-[var(--text-muted)]">{timeAgo(run.createdAt)}</p>
                      </div>
                    </div>
                  )
                })}
          </div>
        </Card>
      </div>
    </div>
  )
}
