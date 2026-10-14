import React, { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Button, Input, Card } from '@ybot/ui'
import { useAppStore } from '../store/app'
import { apiFetch, type WebsiteScanPreview } from '../lib/api'
import type { Bot } from '../store/app'

const isDemoMode = () => import.meta.env.VITE_DEMO_MODE === 'true'

function siteHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'the site'
  }
}

type StartChoice = 'hair-studio' | 'corporate' | 'website' | 'sample' | 'blank'

const CHOICES: Array<{ id: StartChoice; title: string; body: string; tag: string; warm?: boolean }> = [
  {
    id: 'hair-studio',
    title: 'Hair studio',
    body: 'The same kind of conversation as Bella. A greeting, then a booking, a price, the hours, or where the studio is.',
    tag: 'Template · like Bella',
  },
  {
    id: 'website',
    title: 'Scan my website',
    body: 'We read the public pages and draft a greeting, a few doors, and a knowledge base.',
    tag: 'Draft only',
  },
  {
    id: 'corporate',
    title: 'Corporate services',
    body: 'Orders, shipping, returns, plans and pricing, and a handoff to the team.',
    tag: 'What create does now',
    warm: true,
  },
  {
    id: 'sample',
    title: 'An example conversation',
    body: 'Paste a chat. It becomes a draft welcome. Visitors hear it after you publish it to Sandbox.',
    tag: 'Draft only',
  },
  {
    id: 'blank',
    title: 'A blank welcome',
    body: 'One empty chart. You write the first line in the editor.',
    tag: 'Editor',
  },
]

export function BotNewPage() {
  const navigate = useNavigate()
  const { setBots, bots, selectBot, setEnv } = useAppStore()
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [personaName, setPersonaName] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState<StartChoice>('hair-studio')
  const [sample, setSample] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [scan, setScan] = useState<WebsiteScanPreview | null>(null)
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tenant = useQuery({
    queryKey: ['tenant-me'],
    queryFn: () => apiFetch<{ data: { name?: string } | null }>('/tenants/me').then((res) => res.data),
    enabled: !isDemoMode(),
  })

  const voice = personaName.trim() || 'Bella'
  const salon = name.trim() || 'the studio'
  const place = tenant.data?.name?.trim() || 'the studio'
  const greeting = `Hi, I'm ${voice} at ${start === 'website' ? salon : place}. What's your name?`
  const needsSample = start === 'sample' && !sample.trim()
  const needsWebsite = start === 'website' && !scan

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

  async function createBot() {
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
      navigate({ to: '/build/flows' })
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
        }),
      })
      const botsRes = await apiFetch<{ data: Bot[] }>('/bots')
      setBots(botsRes.data)
      if (created?.data?.id) selectBot(created.data.id)
      setEnv('sandbox')
      navigate({ to: '/build/flows' })
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        <b className="text-[var(--text-primary)]">1 Name</b>
        {' · '}
        <b className={step === 2 ? 'text-[var(--text-primary)]' : ''}>2 Starting conversation</b>
        {' · 3 Map'}
      </p>
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
                placeholder="Bella"
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
      ) : (
        <>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">How should {name.trim()} start?</h1>
          <p className="mb-4 mt-1 text-sm text-[var(--text-muted)]">
            {name.trim()} is a new bot. Charts already on this account stay on their own bots.
          </p>
          <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="grid gap-2" role="radiogroup" aria-label="Starting conversation">
              {CHOICES.map((choice) => {
                const selected = start === choice.id
                return (
                  <div
                    key={choice.id}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => setStart(choice.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setStart(choice.id)
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
                      <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] ${choice.warm ? 'bg-amber-50 text-amber-800' : 'bg-[var(--bg-base)] text-[var(--text-secondary)]'}`}>
                        {choice.tag}
                      </span>
                      {choice.id === 'website' && selected && (
                        <span className="mt-3 flex gap-2" onClick={(event) => event.stopPropagation()}>
                          <input
                            value={websiteUrl}
                            onChange={(event) => { setWebsiteUrl(event.target.value); setScan(null) }}
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
                  : `${name.trim()}’s map, if you choose ${CHOICES.find((choice) => choice.id === start)?.title}`}
              </h2>
              <p className="mb-3 mt-1 text-xs text-[var(--text-muted)]">
                {start === 'website'
                  ? 'Nothing is saved until you use this draft.'
                  : start === 'hair-studio' || start === 'corporate'
                    ? 'Nothing is published until you use this. Other bots keep their charts.'
                    : 'This stays a draft. Visitors hear it after you publish it to Sandbox.'}
              </p>
              {start === 'hair-studio' && (
                <>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                    <p className="text-[11px] font-bold text-emerald-800">Visitors start here</p>
                    <p className="mt-1 text-sm text-emerald-950">{greeting}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[
                      ['Where we are', 'Address'],
                      ['Hours', 'When we are open'],
                      ['Services', 'Cuts, colour, prices'],
                      ['Book', 'A time, then a confirmation'],
                    ].map(([title, blurb]) => (
                      <div key={title} className="rounded-lg border border-[var(--border)] px-2 py-2">
                        <p className="text-xs font-semibold text-[var(--text-primary)]">{title}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">{blurb}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {start === 'website' && scan && (
                <>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                    <p className="text-[11px] font-bold text-emerald-800">Visitors start here</p>
                    <p className="mt-1 text-sm text-emerald-950">{greeting}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {scan.doors.map((door) => (
                      <div key={door.flowName} className="rounded-lg border border-[var(--border)] px-2 py-2">
                        <p className="text-xs font-semibold text-[var(--text-primary)]">{door.title}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">{door.blurb}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-[var(--text-primary)]">Knowledge</p>
                    {scan.facts.map((fact) => (
                      <div key={`${fact.label}-${fact.text}`} className="mt-1 flex items-start justify-between gap-3 text-[11px]">
                        <span className="text-[var(--text-secondary)]">{fact.text}</span>
                        <span className="shrink-0 text-[var(--text-muted)]">{fact.label}</span>
                      </div>
                    ))}
                  </div>
                  {scan.note && <p className="mt-3 text-[11px] text-[var(--text-muted)]">{scan.note}</p>}
                </>
              )}
              {start === 'website' && !scan && (
                <p className="text-sm text-[var(--text-secondary)]">
                  {scanning ? 'Reading the public pages.' : 'Paste a public site, then read it. The map appears here before anything is saved.'}
                </p>
              )}
              {start === 'corporate' && (
                <p className="text-sm text-[var(--text-secondary)]">
                  Orders, shipping, returns, plans and pricing, and a handoff. This is the script a new bot used to receive on its own.
                </p>
              )}
              {start === 'sample' && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                  <p className="text-[11px] font-bold text-emerald-800">Draft welcome</p>
                  <p className="mt-1 text-sm text-emerald-950">{sample.trim() || 'Paste a line from the conversation.'}</p>
                </div>
              )}
              {start === 'blank' && (
                <div className="rounded-xl border border-[var(--border)] px-3 py-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Welcome</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Write the first line.</p>
                </div>
              )}
              {error && <p className="mt-3 text-xs text-[var(--error)]">{error}</p>}
              <div className="mt-4 flex flex-col gap-3">
                <span className="text-xs font-semibold text-emerald-700">Other bots stay as they are</span>
                <span className="flex justify-end gap-2">
                  <Button variant="secondary" type="button" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button type="button" className="whitespace-nowrap" disabled={loading || scanning || needsSample || needsWebsite} onClick={() => { void createBot() }}>
                    {loading ? 'Creating…' : start === 'website' ? `Use this draft on ${name.trim()}` : `Use this on ${name.trim()}`}
                  </Button>
                </span>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
