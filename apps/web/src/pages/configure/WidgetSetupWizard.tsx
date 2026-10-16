import React, { useEffect, useState } from 'react'
import { Button } from '@ybot/ui'
import { Check, Copy, CheckCircle2, ChevronRight, Globe, ArrowLeft, ExternalLink, Sparkles } from 'lucide-react'
import { cn } from '@ybot/ui'
import { useChannels, useCreateChannel, useUpdateChannel } from '../../lib/hooks'
import { useAppStore } from '../../store/app'

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'customize' | 'install' | 'verify' | 'done'

type Platform = 'html' | 'wordpress' | 'shopify' | 'wix' | 'squarespace' | 'webflow'

const STEPS: { id: Step; label: string }[] = [
  { id: 'customize', label: 'Customise' },
  { id: 'install',   label: 'Install'   },
  { id: 'verify',    label: 'Verify'    },
]

const PLATFORMS: { id: Platform; label: string; icon: string }[] = [
  { id: 'html',        label: 'HTML / any site', icon: '📄' },
  { id: 'wordpress',   label: 'WordPress',       icon: '🔵' },
  { id: 'shopify',     label: 'Shopify',         icon: '🛍️' },
  { id: 'wix',         label: 'Wix',             icon: '⬛' },
  { id: 'squarespace', label: 'Squarespace',     icon: '⬜' },
  { id: 'webflow',     label: 'Webflow',         icon: '🌊' },
]

const ACCENT_PRESETS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#1d4ed8', '#0f172a', '#64748b',
]

// ── Widget mock preview ───────────────────────────────────────────────────────
// Pure CSS preview — no API call, updates instantly as user types.

function WidgetPreview({ title, accent }: { title: string; accent: string }) {
  const safeTitle = title.trim() || 'Chat with us'
  return (
    <div className="relative h-full flex items-center justify-center select-none">
      {/* Faint "website" background */}
      <div className="absolute inset-0 rounded-[var(--radius-lg)] overflow-hidden">
        <div className="w-full h-full" style={{
          background: 'linear-gradient(160deg, #f8fafc 0%, #f1f5f9 100%)',
        }}>
          {/* Fake website chrome */}
          <div className="p-4 space-y-2 opacity-30">
            <div className="h-3 w-2/3 rounded bg-slate-400" />
            <div className="h-2 w-full rounded bg-slate-300" />
            <div className="h-2 w-5/6 rounded bg-slate-300" />
            <div className="h-2 w-4/5 rounded bg-slate-300" />
            <div className="h-8 w-1/3 rounded-full mt-4" style={{ background: accent, opacity: 0.6 }} />
          </div>
        </div>
      </div>

      {/* Widget panel */}
      <div className="absolute bottom-20 right-4 w-64 rounded-2xl shadow-2xl overflow-hidden bg-white border border-slate-200">
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between" style={{ background: accent }}>
          <span className="text-white font-semibold text-sm truncate">{safeTitle}</span>
          <span className="text-white/80 text-lg leading-none cursor-pointer">×</span>
        </div>
        {/* Messages */}
        <div className="p-3 space-y-2 bg-white">
          <div className="flex items-end gap-1.5">
            <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-white text-[9px] font-bold" style={{ background: accent }}>B</div>
            <div className="bg-slate-100 rounded-xl rounded-bl-sm px-3 py-2 text-xs text-slate-700 max-w-[80%]">
              Hi there! 👋 What's your name?
            </div>
          </div>
          <div className="flex justify-end">
            <div className="rounded-xl rounded-br-sm px-3 py-2 text-xs text-white max-w-[80%]" style={{ background: accent }}>
              Sarah
            </div>
          </div>
          <div className="flex items-end gap-1.5">
            <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-white text-[9px] font-bold" style={{ background: accent }}>B</div>
            <div className="bg-slate-100 rounded-xl rounded-bl-sm px-3 py-2 text-xs text-slate-700 max-w-[80%]">
              Nice to meet you, Sarah! How can I help you today?
            </div>
          </div>
        </div>
        {/* Input */}
        <div className="px-3 pb-3 flex gap-2">
          <div className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-400">
            Type a message…
          </div>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ background: accent }}>↑</div>
        </div>
      </div>

      {/* Bubble */}
      <div
        className="absolute bottom-4 right-4 w-12 h-12 rounded-full flex items-center justify-center text-white text-2xl shadow-lg"
        style={{ background: accent }}
      >
        💬
      </div>
    </div>
  )
}

// ── Platform install instructions ─────────────────────────────────────────────

function getInstallSteps(platform: Platform, embedCode: string): { title: string; steps: string[] } {
  switch (platform) {
    case 'html':
      return {
        title: 'Add to any HTML site',
        steps: [
          'Open your HTML file in a text editor.',
          'Find the closing </body> tag near the bottom of the file.',
          'Paste the code snippet above just before </body>.',
          'Save the file and upload it to your server.',
        ],
      }
    case 'wordpress':
      return {
        title: 'Add to WordPress',
        steps: [
          'Install the free "WPCode" plugin (WordPress Admin → Plugins → Add New).',
          'Go to WPCode → Add Snippet → Custom Code → HTML Snippet.',
          'Paste the code snippet above into the code editor.',
          'Set "Insert Location" to "Footer" and activate the snippet.',
        ],
      }
    case 'shopify':
      return {
        title: 'Add to Shopify',
        steps: [
          'Go to Shopify Admin → Online Store → Themes.',
          'Click "Actions" → "Edit code" on your active theme.',
          'Open the file "theme.liquid" in the Layout folder.',
          'Find the closing </body> tag and paste the snippet just before it. Save.',
        ],
      }
    case 'wix':
      return {
        title: 'Add to Wix',
        steps: [
          'Open the Wix Editor for your site.',
          'Go to Settings (gear icon) → Advanced → Custom Code.',
          'Click "+ Add Custom Code" under the Body section.',
          'Paste the snippet, name it "BotStudio widget", set it to load on "All Pages". Save.',
        ],
      }
    case 'squarespace':
      return {
        title: 'Add to Squarespace',
        steps: [
          'Go to your Squarespace Dashboard → Settings.',
          'Click "Advanced" → "Code Injection".',
          'Paste the snippet into the "Footer" field.',
          'Click "Save". The widget will appear on all pages.',
        ],
      }
    case 'webflow':
      return {
        title: 'Add to Webflow',
        steps: [
          'Open Webflow Designer → Project Settings (gear icon).',
          'Go to the "Custom Code" tab.',
          'Paste the snippet into the "Footer Code" field.',
          'Click "Save Changes" and publish your site.',
        ],
      }
  }
}

function CodeBlock({ code, onCopy, copied }: { code: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="relative rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] overflow-hidden">
      <pre className="p-4 text-xs text-[var(--text-secondary)] font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap pr-16">
        {code}
      </pre>
      <button
        onClick={onCopy}
        className={cn(
          'absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius)] text-xs font-medium transition-colors',
          copied
            ? 'bg-[var(--success)]/15 text-[var(--success)] border border-[var(--success)]/30'
            : 'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
        )}
      >
        {copied ? <CheckCircle2 size={11} /> : <Copy size={11} />}
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

// ── Main wizard ───────────────────────────────────────────────────────────────

interface WidgetSetupWizardProps {
  onClose: () => void
}

export function WidgetSetupWizard({ onClose }: WidgetSetupWizardProps) {
  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()
  const { data: channels = [] } = useChannels()
  const { bots, selectedBotId } = useAppStore()
  const selectedBot = bots.find((b) => b.id === selectedBotId)
  const productionId = selectedBot?.environments.find((env) => env.kind === 'production')?.id
  const liveChannel = channels.find((channel) => channel.kind === 'web' && channel.environmentId === productionId)
    ?? channels.find((channel) => channel.kind === 'web')

  useEffect(() => {
    if (!liveChannel) return
    setSiteName((current) => current || liveChannel.name)
  }, [liveChannel])

  const [step, setStep]             = useState<Step>('customize')
  const [siteName, setSiteName]     = useState('')
  const [widgetTitle, setWidgetTitle] = useState(selectedBot?.name ?? 'Chat with us')
  const [accent, setAccent]         = useState('#6366f1')
  const [platform, setPlatform]     = useState<Platform>('html')
  const [channelId, setChannelId]   = useState<string | null>(null)
  const [creating, setCreating]     = useState(false)
  const [copied, setCopied]         = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const embedCode = channelId
    ? `<!-- BotStudio chat widget -->\n<script>\n  window.YBotTitle = '${widgetTitle}';\n  window.YBotAccentColor = '${accent}';\n</script>\n<script src="${origin}/api/v1/widget.js?id=${channelId}" async></script>`
    : ''

  function copyCode() {
    navigator.clipboard?.writeText(embedCode).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const stepIndex: Record<Step, number> = { customize: 0, install: 1, verify: 2, done: 3 }

  async function handleCustomizeNext() {
    if (!siteName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      if (liveChannel) {
        await updateChannel.mutateAsync({
          id: liveChannel.id,
          name: siteName.trim(),
          config: { ...liveChannel.config, title: widgetTitle, accentColor: accent },
        })
        setChannelId(liveChannel.id)
        setStep('install')
        return
      }
      const envId = selectedBot?.environments.find((env) => env.kind === 'production')?.id
        ?? selectedBot?.environments[0]?.id
        ?? ''
      if (!envId) {
        setCreateError('No environment found for the selected bot. Please select a bot first.')
        setCreating(false)
        return
      }
      const ch = await createChannel.mutateAsync({ name: siteName.trim(), kind: 'web', environmentId: envId })
      setChannelId(ch.id)
      setStep('install')
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Could not create channel')
    } finally {
      setCreating(false)
    }
  }

  // ── Rendered steps ──────────────────────────────────────────────────────────

  function renderCustomize() {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
        {/* Left: form */}
        <div className="space-y-5 overflow-auto py-1">
          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide block mb-1.5">
              What site is this widget for?
            </label>
            <input
              autoFocus
              className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
              placeholder="e.g. Bella Hair Studio Website"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCustomizeNext() }}
            />
            <p className="text-[11px] text-[var(--text-muted)] mt-1">Website chat is already on. This names the live embed inside BotStudio.</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide block mb-1.5">
              Widget header title
            </label>
            <input
              className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
              placeholder="Chat with us"
              value={widgetTitle}
              onChange={(e) => setWidgetTitle(e.target.value)}
            />
            <p className="text-[11px] text-[var(--text-muted)] mt-1">Shown in the top bar of the chat panel.</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide block mb-1.5">
              Brand colour
            </label>
            <div className="flex flex-wrap gap-2 mb-2.5">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setAccent(c)}
                  className={cn(
                    'w-7 h-7 rounded-full border-2 transition-transform',
                    accent === c ? 'border-[var(--text-primary)] scale-110' : 'border-transparent hover:scale-105',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full shrink-0" style={{ background: accent }} />
              <input
                className="w-32 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-1.5 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                placeholder="#6366f1"
                maxLength={7}
              />
              <span className="text-xs text-[var(--text-muted)]">or enter a hex code</span>
            </div>
          </div>

          {createError && (
            <p className="text-xs text-[var(--danger)] bg-[var(--danger)]/10 rounded-[var(--radius)] px-3 py-2">{createError}</p>
          )}
        </div>

        {/* Right: live preview */}
        <div className="hidden lg:block rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-overlay)] relative overflow-hidden" style={{ minHeight: 360 }}>
          <div className="absolute top-2 left-3 text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wide">Live preview</div>
          <WidgetPreview title={widgetTitle} accent={accent} />
        </div>
      </div>
    )
  }

  function renderInstall() {
    if (!channelId) return null
    const instructions = getInstallSteps(platform, embedCode)
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
        {/* Left: platform + steps */}
        <div className="space-y-4 overflow-auto py-1">
          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide block mb-2">
              What platform is your site on?
            </label>
            <div className="grid grid-cols-3 gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 p-2.5 rounded-[var(--radius-md)] border text-xs transition-colors',
                    platform === p.id
                      ? 'border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  <span className="text-base">{p.icon}</span>
                  <span className="text-center leading-tight">{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">{instructions.title}</p>
            <ol className="space-y-2">
              {instructions.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-[var(--text-secondary)]">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Right: code snippet */}
        <div className="space-y-3 overflow-auto py-1">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Your embed snippet</p>
          <CodeBlock code={embedCode} onCopy={copyCode} copied={copied} />
          <p className="text-xs text-[var(--text-muted)]">
            The snippet includes your brand colour and title — no further setup needed.
          </p>
          <button
            onClick={() => {
              const subject = encodeURIComponent('BotStudio widget install snippet')
              const body = encodeURIComponent(`Here's the snippet to add to the website:\n\n${embedCode}\n\nPaste it just before the </body> tag.`)
              window.open(`mailto:?subject=${subject}&body=${body}`)
            }}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ExternalLink size={11} /> Email this snippet to your developer
          </button>
        </div>
      </div>
    )
  }

  function renderVerify() {
    if (!channelId) return null
    const demoUrl = `${origin}/api/v1/public/demo/${channelId}`
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
        {/* Left: instructions */}
        <div className="space-y-4 overflow-auto py-1">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Test the widget right now</p>
            <p className="text-sm text-[var(--text-secondary)]">
              Open the demo page to experience the widget exactly as a customer would — no code, no deployment needed.
            </p>
          </div>

          <button
            onClick={() => window.open(demoUrl, '_blank')}
            className="w-full flex items-center justify-between px-4 py-3 rounded-[var(--radius-md)] border-2 border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)] hover:bg-[var(--accent)]/15 transition-colors"
          >
            <span className="font-semibold text-sm">🌐 Open demo page</span>
            <ExternalLink size={14} />
          </button>

          <div className="border-t border-[var(--border)] pt-4">
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Verify on your own site</p>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              After adding the snippet, visit your site and look for the chat bubble in the bottom-right corner. Send a test message — it will appear in BotStudio → Inbox.
            </p>
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-overlay)] border border-[var(--border)] divide-y divide-[var(--border)]">
              {[
                { icon: '💬', text: 'Chat bubble appears in the bottom-right corner' },
                { icon: '👋', text: 'Bot asks for the visitor\'s name' },
                { icon: '🤖', text: 'AI responds to messages' },
                { icon: '📥', text: 'Conversation appears in BotStudio → Inbox' },
              ].map(({ icon, text }) => (
                <div key={text} className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-[var(--text-secondary)]">
                  <span>{icon}</span> {text}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: iframe preview */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] overflow-hidden" style={{ minHeight: 340 }}>
          <iframe
            src={`${origin}/api/v1/widget-test/${channelId}?title=${encodeURIComponent(widgetTitle)}&color=${encodeURIComponent(accent)}`}
            title="Widget test"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </div>
      </div>
    )
  }

  function renderDone() {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-5 py-8">
        <div className="w-16 h-16 rounded-full bg-[var(--success)]/15 flex items-center justify-center">
          <CheckCircle2 size={32} className="text-[var(--success)]" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">You're all set! 🎉</h2>
          <p className="text-sm text-[var(--text-muted)] max-w-sm">
            Your widget is live. Every chat from your site will appear in the Inbox.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-xl mt-2">
          {[
            { icon: '📚', title: 'Add knowledge',       desc: 'Upload FAQs, docs, and URLs so the bot answers accurately.',  path: '/build/knowledge' },
            { icon: '📥', title: 'Open Inbox',          desc: 'See incoming conversations and reply as a human agent.',       path: '/inbox/chats' },
            { icon: '📊', title: 'Check analytics',     desc: 'Track CSAT scores, conversation volume, and response times.', path: '/analytics' },
          ].map((c) => (
            <button
              key={c.title}
              onClick={() => { onClose(); window.location.hash = c.path }}
              className="text-left p-4 rounded-[var(--radius-lg)] border border-[var(--border)] hover:border-[var(--accent)]/50 hover:bg-[var(--accent-muted)] transition-colors"
            >
              <span className="text-2xl block mb-2">{c.icon}</span>
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">{c.title}</p>
              <p className="text-xs text-[var(--text-muted)]">{c.desc}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Layout ──────────────────────────────────────────────────────────────────

  const isDone = step === 'done'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-base)]">
      {/* Top bar */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center">
            <Globe size={14} className="text-white" />
          </div>
          <span className="font-semibold text-[var(--text-primary)]">Web widget setup</span>
        </div>

        {/* Step indicator */}
        {!isDone && (
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const idx = stepIndex[step]
              const done = i < idx
              const active = i === idx
              return (
                <React.Fragment key={s.id}>
                  {i > 0 && <ChevronRight size={13} className="text-[var(--text-muted)]" />}
                  <div className={cn(
                    'flex items-center gap-1.5 text-xs font-medium',
                    done ? 'text-[var(--success)]' : active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]',
                  )}>
                    {done
                      ? <Check size={13} />
                      : <span className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[10px]', active ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-overlay)] text-[var(--text-muted)]')}>{i + 1}</span>
                    }
                    {s.label}
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        )}

        <button
          onClick={onClose}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          ✕ Close
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden px-6 py-6">
        {step === 'customize' && renderCustomize()}
        {step === 'install'   && renderInstall()}
        {step === 'verify'    && renderVerify()}
        {step === 'done'      && renderDone()}
      </div>

      {/* Bottom nav */}
      {!isDone && (
        <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-surface)] px-6 py-4 flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              if (step === 'install') setStep('customize')
              else if (step === 'verify') setStep('install')
              else onClose()
            }}
            className="gap-1.5"
          >
            <ArrowLeft size={14} />
            {step === 'customize' ? 'Cancel' : 'Back'}
          </Button>

          {step === 'customize' && (
            <Button
              disabled={!siteName.trim() || creating}
              onClick={handleCustomizeNext}
              className="gap-1.5"
            >
              {creating ? 'Creating channel…' : 'Next: Install'}
              {!creating && <ChevronRight size={14} />}
            </Button>
          )}
          {step === 'install' && (
            <Button onClick={() => setStep('verify')} className="gap-1.5">
              Next: Verify <ChevronRight size={14} />
            </Button>
          )}
          {step === 'verify' && (
            <Button onClick={() => setStep('done')} className="gap-1.5">
              <Sparkles size={14} /> Mark as complete
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
