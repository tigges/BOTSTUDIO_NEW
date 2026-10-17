import React, { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Avatar, Badge, Button, Input, Card } from '@ybot/ui'
import type { FlowGraph } from '@ybot/runtime'
import {
  SALON_WELCOME_NAME,
  START_CLUSTERS,
  START_OPTIONS,
  identityFor,
  personaAvatar,
  startPreview,
  startWalkChapters,
  type BotStart,
  type ClusterId,
  type StartPath,
  type StartTemplate,
  type StudioCatalog,
} from '@ybot/shared'
import { useAppStore } from '../store/app'
import { apiFetch, bots as botsApi, type WebsiteScanPreview } from '../lib/api'
import type { Bot } from '../store/app'
import { JourneyTest } from './build/JourneyTest'
import { JourneyPreview } from '../components/JourneyPreview'

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
  const [path, setPath] = useState<StartPath>('website')
  const [start, setStart] = useState<BotStart | null>(null)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [clusterFilter, setClusterFilter] = useState<ClusterId | 'all'>('all')
  const [sample, setSample] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [scan, setScan] = useState<WebsiteScanPreview | null>(null)
  const [scanning, setScanning] = useState(false)
  const [trying, setTrying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const catalog = useQuery({
    queryKey: ['start-catalog'],
    queryFn: () => botsApi.startCatalog().then((res) => res.data),
    enabled: !isDemoMode(),
  })

  const clusters = catalog.data?.clusters ?? START_CLUSTERS
  const templates: CatalogTemplate[] = (catalog.data?.templates as CatalogTemplate[] | undefined) ?? []
  const gallery = clusterFilter === 'all'
    ? templates
    : templates.filter((item) => item.clusterId === clusterFilter)
  const selectedTemplate = templates.find((item) => (
    start === 'learned' ? item.templateId === templateId : item.id === start && !item.templateId
  ))
  const identity = identityFor(start)
  const company = name.trim() || 'your company'
  const voice = personaName.trim() || selectedTemplate?.persona || identity.persona
  const accent = selectedTemplate?.accent || identity.accent
  const avatarUrl = personaAvatar(voice || company, accent)
  const preview = startPreview({
    start: start ?? (path === 'website' || path === 'sample' || path === 'blank' ? path : 'blank'),
    companyName: company,
    personaName: voice || null,
    scanDoors: scan?.doors,
    scanGreeting: path === 'website' ? (scan?.greeting ?? `Hi, I'm ${voice || 'Bella'} at ${company}. What's your name?`) : undefined,
    sample,
  })
  const walkStart = (start ?? (path === 'website' || path === 'sample' || path === 'blank' ? path : null)) as BotStart | null
  const walkChapters = walkStart && walkStart !== 'website' && walkStart !== 'sample' && walkStart !== 'blank'
    ? startWalkChapters({ start: walkStart, companyName: company, personaName: voice || null })
    : []
  const needsSample = path === 'sample' && !sample.trim()
  const needsWebsite = path === 'website' && !scan
  const canCreate = path === 'template' ? Boolean(start) : !needsSample && !needsWebsite

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

  function pickPath(next: StartPath) {
    setPath(next)
    setTrying(false)
    if (next === 'template') {
      setStart(null)
      setTemplateId(null)
      return
    }
    setStart(next)
    setTemplateId(null)
    if (next !== 'website') setScan(null)
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
  }

  async function createBot() {
    const chosen = path === 'template' ? start : path
    if (!chosen) return
    setLoading(true)
    setError(null)
    if (isDemoMode()) {
      const demoBot: Bot = {
        id: `demo-bot-${Date.now()}`,
        name,
        personaName: voice || null,
        avatarUrl,
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
          personaName: voice || undefined,
          start: chosen,
          sample: chosen === 'sample' ? sample.trim() : undefined,
          websiteUrl: chosen === 'website' ? websiteUrl.trim() : undefined,
          templateId: chosen === 'learned' ? templateId : undefined,
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
      <b className={step >= 2 ? 'text-[var(--text-primary)]' : ''}>2 How it starts</b>
      {path === 'template' ? (
        <>
          {' · '}
          <b className={step === 3 ? 'text-[var(--text-primary)]' : ''}>3 Template</b>
          {' · 4 Map'}
        </>
      ) : ' · 3 Map'}
    </p>
  ), [path, step])

  const mapCard = (
    <Card>
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">
        {path === 'website' && scan
          ? `${name.trim()}’s map, from ${siteHost(scan.pages[0] ?? scan.url)}`
          : path === 'template' && selectedTemplate
            ? `${name.trim()} as ${selectedTemplate.title}`
            : `${name.trim()}’s map`}
      </h2>
      <p className="mb-3 mt-1 text-xs text-[var(--text-muted)]">
        {voice ? `${voice} is who guests hear. Nothing is saved until you use this.` : 'Nothing is saved until you use this.'}
      </p>
      {path === 'website' && !scan ? (
        <p className="text-sm text-[var(--text-secondary)]">
          {scanning ? 'Reading the public pages.' : 'Paste a public site, then read it. The map appears here before anything is saved.'}
        </p>
      ) : (
        <JourneyPreview
          greeting={preview.greeting}
          doors={preview.doors}
          empty={path === 'blank' || start === 'blank' ? 'Write the first line on the chart.' : undefined}
          persona={voice || undefined}
          avatarUrl={voice ? avatarUrl : undefined}
        />
      )}
      {path === 'website' && scan?.facts && scan.facts.length > 0 && (
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
      {scan?.note && path === 'website' && <p className="mt-3 text-[11px] text-[var(--text-muted)]">{scan.note}</p>}
      {((path === 'website' && scan?.chapters && scan.chapters.length > 0) || walkChapters.length > 0) && (
        <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => setTrying(true)}>
          Try this walk
        </Button>
      )}
      {error && <p className="mt-3 text-xs text-[var(--error)]">{error}</p>}
      <div className="mt-4 flex flex-col gap-3">
        <span className="text-xs font-semibold text-emerald-700">Other bots stay as they are</span>
        <span className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={() => setStep(path === 'template' && step === 3 ? 2 : 1)}>
            Back
          </Button>
          <Button type="button" className="whitespace-nowrap" disabled={loading || scanning || !canCreate} onClick={() => { void createBot() }}>
            {loading ? 'Creating…' : path === 'website' ? `Use this draft on ${name.trim()}` : `Use this on ${name.trim()}`}
          </Button>
        </span>
      </div>
    </Card>
  )

  const tryChapters = path === 'website' && scan?.chapters
    ? scan.chapters.map((chapter) => ({ name: chapter.name, graph: chapter.graph as unknown as FlowGraph }))
    : walkChapters.map((chapter) => ({ name: chapter.name, graph: chapter.graph as unknown as FlowGraph }))

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
                label="Company name (internal name)"
                placeholder="Bella Hair Studio"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Input
                label="Persona name (customer-facing)"
                placeholder="Bella"
                value={personaName}
                onChange={(e) => setPersonaName(e.target.value)}
              />
              <Input
                label="Description (optional)"
                placeholder="Receptionist of Bella Hair Studio"
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
          <h1 className="text-xl font-bold text-[var(--text-primary)]">How should {name.trim()} start?</h1>
          <p className="mb-4 mt-1 text-sm text-[var(--text-muted)]">
            Scan a site, paste a conversation, or start empty.
          </p>
          <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="grid gap-2" role="radiogroup" aria-label="How it starts">
              {START_OPTIONS.map((choice) => {
                const selected = path === choice.id
                return (
                  <div
                    key={choice.id}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => pickPath(choice.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        pickPath(choice.id)
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
                      {choice.id === 'template' && selected && (
                        <button
                          type="button"
                          className="mt-3 text-xs font-semibold text-[var(--accent)]"
                          onClick={(event) => { event.stopPropagation(); setStep(3) }}
                        >
                          Choose a template
                        </button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
            {path === 'template' ? (
              <Card>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Then pick the case</h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Hair and Spa Salon, CRM, software, inbox, or commerce. Each one has its own persona and speaks that kind of conversation.
                </p>
                <div className="mt-4 flex justify-end">
                  <Button type="button" onClick={() => setStep(3)}>
                    Choose a template
                  </Button>
                </div>
              </Card>
            ) : mapCard}
          </div>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">A template for {name.trim()}</h1>
          <p className="mb-4 mt-1 text-sm text-[var(--text-muted)]">
            Pick a case, then see its map. Who speaks and how they talk follow that template.
          </p>
          <div className="mb-4 flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setClusterFilter('all')}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                clusterFilter === 'all'
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--border)] text-[var(--text-muted)]'
              }`}
            >
              All
            </button>
            {clusters.filter((item) => item.id !== 'custom').map((cluster) => (
              <button
                key={cluster.id}
                type="button"
                onClick={() => setClusterFilter(cluster.id as ClusterId)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  clusterFilter === cluster.id
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                    : 'border-[var(--border)] text-[var(--text-muted)]'
                }`}
              >
                {cluster.title}
              </button>
            ))}
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {gallery.map((choice) => {
                const selected = start === 'learned' ? choice.templateId === templateId : start === choice.id && !choice.templateId
                const chip = identityFor(choice.id === 'learned' ? choice.clusterId : choice.id)
                return (
                  <button
                    key={choice.templateId ?? choice.id}
                    type="button"
                    onClick={() => pickTemplate(choice)}
                    className={`overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] text-left transition-colors ${
                      selected ? 'border-[var(--accent)] shadow-[0_0_0_3px_rgba(109,94,252,0.15)]' : 'border-[var(--border)] hover:border-[var(--accent)]/40'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 border-b border-[var(--border)] p-4 pb-3">
                      <Avatar name={choice.persona || chip.persona || choice.title} src={personaAvatar(choice.persona || chip.persona || choice.title, choice.accent || chip.accent)} size="md" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{choice.title}</p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <Badge variant="muted">{choice.role || chip.role}</Badge>
                          <span className="text-[10px] text-[var(--text-muted)]">{choice.persona || chip.persona}</span>
                        </div>
                      </div>
                    </div>
                    <p className="px-4 py-3 text-xs leading-relaxed text-[var(--text-secondary)]">{choice.body}</p>
                    <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--bg-overlay)] px-4 py-2.5 text-[11px] text-[var(--text-muted)]">
                      <span>{choice.tag}</span>
                      <span>{clusters.find((item) => item.id === choice.clusterId)?.title ?? choice.clusterId}</span>
                    </div>
                  </button>
                )
              })}
            </div>
            {mapCard}
          </div>
        </>
      )}
      {trying && tryChapters.length > 0 && (
        <div className="fixed inset-y-0 right-0 z-40 shadow-xl">
          <JourneyTest
            botName={voice || name.trim() || 'Bot'}
            avatarUrl={avatarUrl}
            chapters={tryChapters}
            startChapter={
              path === 'website'
                ? (scan?.chapters?.find((chapter) => chapter.name === SALON_WELCOME_NAME)?.name ?? scan?.chapters?.[0]?.name ?? '')
                : (tryChapters[0]?.name ?? '')
            }
            environmentLabel="Draft"
            chapterKey={`${walkStart ?? path}-${company}-${voice}`}
            catalog={scan?.catalog as StudioCatalog | undefined}
            onChapter={() => {}}
            onClose={() => setTrying(false)}
          />
        </div>
      )}
    </div>
  )
}
