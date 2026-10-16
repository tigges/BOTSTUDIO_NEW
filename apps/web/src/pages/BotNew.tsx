import React, { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Button, Input, Card } from '@ybot/ui'
import type { FlowGraph } from '@ybot/runtime'
import {
  BAKED_TEMPLATES,
  SALON_WELCOME_NAME,
  START_CLUSTERS,
  WIZARD_CHANNELS,
  startPreview,
  type BotStart,
  type ClusterId,
  type StartTemplate,
  type StudioCatalog,
} from '@ybot/shared'
import { useAppStore } from '../store/app'
import { apiFetch, bots as botsApi, type WebsiteScanPreview } from '../lib/api'
import type { Bot } from '../store/app'
import { JourneyTest } from './build/JourneyTest'
import { ClusterSketch, JourneyPreview } from '../components/JourneyPreview'

const isDemoMode = () => import.meta.env.VITE_DEMO_MODE === 'true'

function siteHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'the site'
  }
}

type CatalogTemplate = StartTemplate & { templateId?: string }

export function BotNewPage() {
  const navigate = useNavigate()
  const { setBots, bots, selectBot, setEnv } = useAppStore()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [name, setName] = useState('')
  const [personaName, setPersonaName] = useState('')
  const [description, setDescription] = useState('')
  const [clusterId, setClusterId] = useState<ClusterId | null>(null)
  const [start, setStart] = useState<BotStart | null>(null)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [sample, setSample] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [scan, setScan] = useState<WebsiteScanPreview | null>(null)
  const [scanning, setScanning] = useState(false)
  const [trying, setTrying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [channels, setChannels] = useState<string[]>([])
  const tenant = useQuery({
    queryKey: ['tenant-me'],
    queryFn: () => apiFetch<{ data: { name?: string } | null }>('/tenants/me').then((res) => res.data),
    enabled: !isDemoMode(),
  })
  const catalog = useQuery({
    queryKey: ['start-catalog'],
    queryFn: () => botsApi.startCatalog().then((res) => res.data),
    enabled: !isDemoMode(),
  })

  const clusters = catalog.data?.clusters ?? START_CLUSTERS
  const templates: CatalogTemplate[] = (catalog.data?.templates as CatalogTemplate[] | undefined) ?? BAKED_TEMPLATES
  const clusterTemplates = clusterId ? templates.filter((item) => item.clusterId === clusterId) : []
  const selectedTemplate = templates.find((item) => (
    start === 'learned' ? item.templateId === templateId : item.id === start && !item.templateId
  )) ?? clusterTemplates.find((item) => item.id === start)

  const voice = personaName.trim() || (start === 'hair-studio' ? 'Bella' : '')
  const salon = name.trim() || tenant.data?.name?.trim() || 'the studio'
  const preview = startPreview({
    start: start ?? 'blank',
    companyName: salon,
    personaName: voice || null,
    scanDoors: scan?.doors,
    scanGreeting: start === 'website' ? `Hi, I'm ${voice || 'Bella'} at ${salon}. What's your name?` : undefined,
    sample,
  })
  const needsSample = start === 'sample' && !sample.trim()
  const needsWebsite = start === 'website' && !scan
  const canCreate = Boolean(start) && !needsSample && !needsWebsite

  async function readSite() {
    const url = websiteUrl.trim()
    if (!url) return
    setScanning(true)
    setError(null)
    setScan(null)
    try {
      const result = await apiFetch<{ data: WebsiteScanPreview }>('/bots/scan', {
        method: 'POST',
        body: JSON.stringify({ url, personaName: personaName.trim() || undefined, companyName: name.trim() }),
      })
      setScan(result.data)
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  function pickCluster(id: ClusterId) {
    setClusterId(id)
    const first = templates.find((item) => item.clusterId === id && !item.templateId)
    setStart(first ? first.id as BotStart : null)
    setTemplateId(null)
    setTrying(false)
    setStep(3)
  }

  function pickTemplate(item: CatalogTemplate) {
    setTrying(false)
    if (item.templateId) {
      setStart('learned')
      setTemplateId(item.templateId)
      return
    }
    setStart(item.id as BotStart)
    setTemplateId(null)
    if (item.id !== 'website') setScan(null)
  }

  function toggleChannel(id: string, action: string) {
    if (action !== 'connect') return
    setChannels((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function createBot() {
    if (!start) return
    setLoading(true)
    setError(null)
    if (isDemoMode()) {
      const demoBot: Bot = {
        id: `demo-bot-${Date.now()}`,
        name,
        personaName: personaName.trim() || null,
        description: description || undefined,
        status: 'active',
        environments: [
          { id: 'demo-env-sandbox', kind: 'sandbox', name: 'Sandbox' },
          { id: 'demo-env-prod', kind: 'production', name: 'Production' },
        ],
      }
      setBots([...bots, demoBot])
      selectBot(demoBot.id)
      setEnv('sandbox')
      navigate({ to: '/build/journey' })
      return
    }
    try {
      const created = await apiFetch<{ data: Bot }>('/bots', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          personaName: personaName.trim() || undefined,
          start,
          sample: start === 'sample' ? sample.trim() : undefined,
          websiteUrl: start === 'website' ? websiteUrl.trim() : undefined,
          templateId: start === 'learned' ? templateId : undefined,
          channels,
        }),
      })
      const botsRes = await apiFetch<{ data: Bot[] }>('/bots')
      setBots(botsRes.data)
      if (created?.data?.id) selectBot(created.data.id)
      setEnv('sandbox')
      navigate({ to: '/build/journey' })
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const stepLabel = useMemo(() => (
    <p className="mb-3 text-xs text-[var(--text-muted)]">
      <b className="text-[var(--text-primary)]">1 Name</b>
      {' · '}
      <b className={step >= 2 ? 'text-[var(--text-primary)]' : ''}>2 Cluster</b>
      {' · '}
      <b className={step === 3 ? 'text-[var(--text-primary)]' : ''}>3 Template</b>
      {' · 4 Map'}
    </p>
  ), [step])

  return (
    <div className="mx-auto max-w-5xl p-6">
      {stepLabel}
      {step === 1 ? (
        <div className="max-w-md">
          <h1 className="mb-4 text-xl font-bold text-[var(--text-primary)]">Name this bot</h1>
          <Card>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (name.trim()) setStep(2)
              }}
            >
              <Input
                label="Internal name"
                placeholder="Yuzu"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                hint="Visible only inside BotStudio"
              />
              <Input
                label="Persona name (customer-facing)"
                placeholder={clusterId === 'hair' ? 'Bella' : 'Optional'}
                value={personaName}
                onChange={(e) => setPersonaName(e.target.value)}
                hint="The greeting uses this name. Hair studio says Bella when you leave it empty."
              />
              <Input
                label="Description (optional)"
                placeholder="Front desk for the studio"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => navigate({ to: '/bots' })}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!name.trim()}>
                  Continue
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : step === 2 ? (
        <>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">What kind of conversation is {name.trim()}?</h1>
          <p className="mb-4 mt-1 text-sm text-[var(--text-muted)]">
            Pick a cluster first. Hair studio and corporate services are templates inside those clusters, not the first choice.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {clusters.map((cluster) => {
              const selected = clusterId === cluster.id
              const count = templates.filter((item) => item.clusterId === cluster.id).length
              return (
                <button
                  key={cluster.id}
                  type="button"
                  onClick={() => pickCluster(cluster.id as ClusterId)}
                  className={`rounded-xl border bg-[var(--bg-surface)] p-4 text-left ${
                    selected ? 'border-[var(--accent)] shadow-[0_0_0_3px_rgba(109,94,252,0.15)]' : 'border-[var(--border)]'
                  }`}
                >
                  <ClusterSketch accent={selected} />
                  <p className="mt-3 text-sm font-semibold text-[var(--text-primary)]">{cluster.title}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{cluster.body}</p>
                  <p className="mt-2 text-[11px] text-[var(--text-secondary)]">{count} {count === 1 ? 'template' : 'templates'}</p>
                </button>
              )
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" type="button" onClick={() => setStep(1)}>Back</Button>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">
            {clusters.find((item) => item.id === clusterId)?.title ?? 'Template'} for {name.trim()}
          </h1>
          <p className="mb-4 mt-1 text-sm text-[var(--text-muted)]">
            {name.trim()} is a new bot. Charts already on this account stay on their own bots.
          </p>
          <div className="grid items-start gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="grid gap-2" role="radiogroup" aria-label="Template">
              {clusterTemplates.map((choice) => {
                const selected = start === 'learned' ? choice.templateId === templateId : start === choice.id && !choice.templateId
                return (
                  <div
                    key={choice.templateId ?? choice.id}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => pickTemplate(choice)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        pickTemplate(choice)
                      }
                    }}
                    className={`grid cursor-pointer grid-cols-[18px_1fr] gap-3 rounded-xl border bg-[var(--bg-surface)] px-4 py-3 text-left ${
                      selected ? 'border-[var(--accent)] shadow-[0_0_0_3px_rgba(109,94,252,0.15)]' : 'border-[var(--border)]'
                    }`}
                  >
                    <span
                      className={`mt-0.5 h-4 w-4 rounded-full border-2 ${
                        selected ? 'border-[var(--accent)] bg-[var(--accent)] shadow-[inset_0_0_0_3px_var(--bg-surface)]' : 'border-[var(--border)]'
                      }`}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-[var(--text-primary)]">{choice.title}</span>
                      <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{choice.body}</span>
                      <span className="mt-2 inline-block rounded-full bg-[var(--bg-base)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                        {choice.tag}
                      </span>
                      {choice.id === 'website' && selected && (
                        <span className="mt-3 flex gap-2" onClick={(event) => event.stopPropagation()}>
                          <input
                            value={websiteUrl}
                            onChange={(event) => { setWebsiteUrl(event.target.value); setScan(null); setTrying(false) }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                void readSite()
                              }
                            }}
                            placeholder="https://yuzu.hair"
                            aria-label="Website address"
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-2 py-2 text-xs text-[var(--text-primary)]"
                          />
                          <button
                            type="button"
                            disabled={scanning || !websiteUrl.trim()}
                            onClick={() => { void readSite() }}
                            className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {scanning ? 'Reading…' : 'Read site'}
                          </button>
                        </span>
                      )}
                      {choice.id === 'sample' && selected && (
                        <textarea
                          value={sample}
                          onChange={(event) => setSample(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          placeholder="Hi, I'm the receptionist. What's your name?"
                          className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-2 text-xs text-[var(--text-primary)]"
                          rows={3}
                        />
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
            <Card>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {start === 'website' && scan
                  ? `${name.trim()}’s map, from ${siteHost(scan.pages[0] ?? scan.url)}`
                  : `${name.trim()}’s map${selectedTemplate ? `, if you choose ${selectedTemplate.title}` : ''}`}
              </h2>
              <p className="mb-3 mt-1 text-xs text-[var(--text-muted)]">
                Nothing is saved until you use this. Website chat is already on. Connect the others the same way as integrations.
              </p>
              {start === 'website' && !scan ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  {scanning ? 'Reading the public pages.' : 'Paste a public site, then read it. The map appears here before anything is saved.'}
                </p>
              ) : (
                <JourneyPreview
                  greeting={preview.greeting}
                  doors={preview.doors}
                  empty={start === 'blank' ? 'Write the first line on the chart.' : undefined}
                />
              )}
              {start === 'website' && scan?.facts && scan.facts.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">Knowledge</p>
                  {scan.facts.map((fact) => (
                    <div key={`${fact.label}-${fact.text}`} className="mt-1 flex items-start justify-between gap-3 text-[11px]">
                      <span className="text-[var(--text-secondary)]">{fact.text}</span>
                      <span className="shrink-0 text-[var(--text-muted)]">{fact.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {scan?.note && start === 'website' && <p className="mt-3 text-[11px] text-[var(--text-muted)]">{scan.note}</p>}
              {start === 'website' && scan?.chapters && scan.chapters.length > 0 && (
                <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => setTrying(true)}>
                  Try this walk
                </Button>
              )}
              <p className="mb-2 mt-5 text-xs font-semibold text-[var(--text-primary)]">Channels</p>
              <div className="grid grid-cols-2 gap-2">
                {WIZARD_CHANNELS.map((channel) => {
                  const connected = channel.action === 'on' || channels.includes(channel.id)
                  return (
                    <div key={channel.id} className={`rounded-lg border px-2 py-2 ${connected && channel.action !== 'soon' ? 'border-emerald-200 bg-emerald-50' : 'border-[var(--border)]'}`}>
                      <p className="text-xs font-semibold text-[var(--text-primary)]">{channel.label}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{channel.body}</p>
                      {channel.action === 'on' && <p className="mt-1 text-[11px] font-medium text-emerald-800">On</p>}
                      {channel.action === 'soon' && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Soon</p>}
                      {channel.action === 'connect' && (
                        <button
                          type="button"
                          className="mt-1 text-[11px] font-semibold text-[var(--accent)]"
                          onClick={() => toggleChannel(channel.id, channel.action)}
                        >
                          {connected ? 'Connected' : 'Connect'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
              {error && <p className="mt-3 text-xs text-[var(--error)]">{error}</p>}
              <div className="mt-4 flex flex-col gap-3">
                <span className="text-xs font-semibold text-emerald-700">Other bots stay as they are</span>
                <span className="flex justify-end gap-2">
                  <Button variant="secondary" type="button" onClick={() => setStep(2)}>
                    Back
                  </Button>
                  <Button type="button" className="whitespace-nowrap" disabled={loading || scanning || !canCreate} onClick={() => { void createBot() }}>
                    {loading ? 'Creating…' : start === 'website' ? `Use this draft on ${name.trim()}` : `Use this on ${name.trim()}`}
                  </Button>
                </span>
              </div>
            </Card>
          </div>
        </>
      )}
      {trying && scan?.chapters && (
        <div className="fixed inset-y-0 right-0 z-40 shadow-xl">
          <JourneyTest
            botName={name.trim() || 'Bot'}
            chapters={scan.chapters.map((chapter) => ({ name: chapter.name, graph: chapter.graph as unknown as FlowGraph }))}
            startChapter={scan.chapters.find((chapter) => chapter.name === SALON_WELCOME_NAME)?.name ?? scan.chapters[0]?.name ?? ''}
            environmentLabel="Draft"
            chapterKey={scan.url}
            catalog={scan.catalog as StudioCatalog | undefined}
            onChapter={() => {}}
            onClose={() => setTrying(false)}
          />
        </div>
      )}
    </div>
  )
}
