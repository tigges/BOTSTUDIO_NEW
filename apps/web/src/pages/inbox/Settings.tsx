import React, { useState, useEffect } from 'react'
import { Clock, Save, ToggleLeft, ToggleRight, Loader2, Users, Zap, MessageSquare } from 'lucide-react'
import { Button, Card } from '@ybot/ui'
import { PlannedBadge } from '../../components/PlannedFeature'
import { useInboxConfig, useSaveInboxConfig } from '../../lib/hooks'
import { useAppStore } from '../../store/app'

interface ToggleRowProps { label: string; description: string; value: boolean; onChange: (v: boolean) => void }
function PlannedRow({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-[var(--border)] last:border-0">
      <div>
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
      </div>
      <PlannedBadge />
    </div>
  )
}

function ToggleRow({ label, description, value, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-[var(--border)] last:border-0">
      <div>
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
      </div>
      <button onClick={() => onChange(!value)} className="shrink-0">
        {value ? <ToggleRight size={24} className="text-[var(--accent)]" /> : <ToggleLeft size={24} className="text-[var(--text-muted)]" />}
      </button>
    </div>
  )
}

const DEFAULTS = {
  autoAssign: true, roundRobin: false, botHandoverOnIdle: true,
  requireClosureNote: false, csatOnResolve: true, notifyOnEscalation: true,
  showTypingIndicator: true, allowContactMerge: true,
}

const DEFAULT_AWAY = "Thanks for your message. We're currently outside our working hours and will reply when the team is back."

export function InboxSettingsPage() {
  const displayName = useAppStore((s) => s.user?.displayName?.trim() || s.user?.email || 'you')
  const { data: savedConfig, isLoading } = useInboxConfig()
  const saveConfig = useSaveInboxConfig()
  const [settings, setSettings] = useState(DEFAULTS)
  const [slaHours, setSlaHours] = useState({ first_response: '1', resolution: '24' })
  const [limitQueue, setLimitQueue] = useState(false)
  const [workingHours, setWorkingHours] = useState({ start: '09:00', end: '18:00', timezone: 'Europe/London' })
  const [awayMessage, setAwayMessage] = useState(DEFAULT_AWAY)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!savedConfig) return
    const cfg = savedConfig as Record<string, unknown>
    if (cfg['toggles']) setSettings({ ...DEFAULTS, ...(cfg['toggles'] as typeof DEFAULTS) })
    if (cfg['sla']) setSlaHours({ ...slaHours, ...(cfg['sla'] as typeof slaHours) })
    if (cfg['workingHours']) {
      const hours = cfg['workingHours'] as { enabled?: boolean; start?: string; end?: string; timezone?: string; awayMessage?: string }
      const hasWindow = Boolean(hours.start && hours.end)
      setLimitQueue(hours.enabled === false ? false : hasWindow)
      setWorkingHours({
        start: hours.start ?? workingHours.start,
        end: hours.end ?? workingHours.end,
        timezone: hours.timezone ?? workingHours.timezone,
      })
      if (hours.awayMessage) setAwayMessage(hours.awayMessage)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedConfig])

  function toggle(key: keyof typeof settings) {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  async function save() {
    await saveConfig.mutateAsync({
      toggles: settings,
      sla: slaHours,
      workingHours: limitQueue
        ? { enabled: true, ...workingHours, awayMessage }
        : { enabled: false, awayMessage },
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-4 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold text-[var(--text-primary)]">Inbox Settings</h1>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">Your inbox, {displayName}. These choices apply to you on this account.</p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={save} disabled={saveConfig.isPending}>
            {saveConfig.isPending ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}
            {saved ? 'Saved!' : 'Save changes'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl space-y-6">

          {/* Assignment */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Users size={15} className="text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Assignment</h2>
            </div>
            <Card>
              <PlannedRow label="Auto-assign conversations" description="Automatically assign incoming conversations to available agents" />
              <PlannedRow label="Round-robin assignment" description="Distribute conversations evenly across agents in sequence" />
              <PlannedRow label="Bot handover on agent idle" description="Return conversation to bot if agent doesn't respond within 10 minutes" />
            </Card>
          </section>

          {/* SLA */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={15} className="text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">SLA Targets</h2>
            </div>
            <Card>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'first_response' as const, label: 'First response time (hours)', desc: 'Target time for initial agent response' },
                  { key: 'resolution' as const, label: 'Resolution time (hours)', desc: 'Target time to fully resolve a conversation' },
                ].map((field) => (
                  <div key={field.key}>
                    <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">{field.label}</label>
                    <input
                      type="number" min="0.5" step="0.5"
                      value={slaHours[field.key]}
                      onChange={(e) => setSlaHours((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                    />
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">{field.desc}</p>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          {/* Working hours */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={15} className="text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Working Hours</h2>
            </div>
            <Card>
              <p className="text-xs text-[var(--text-muted)] mb-3">The bot answers 24/7. Turn this on when the queue should follow office hours. The bot keeps answering outside that window.</p>
              <ToggleRow
                label="Limit the queue to working hours"
                description="People and the queue clock use this window. Leave it off for a round-the-clock queue."
                value={limitQueue}
                onChange={setLimitQueue}
              />
              {limitQueue && (
              <>
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Start time</label>
                  <input type="time" value={workingHours.start} onChange={(e) => setWorkingHours((p) => ({ ...p, start: e.target.value }))}
                    className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">End time</label>
                  <input type="time" value={workingHours.end} onChange={(e) => setWorkingHours((p) => ({ ...p, end: e.target.value }))}
                    className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Timezone</label>
                  <select value={workingHours.timezone} onChange={(e) => setWorkingHours((p) => ({ ...p, timezone: e.target.value }))}
                    className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none">
                    <option>Europe/London</option><option>Europe/Paris</option>
                    <option>America/New_York</option><option>America/Los_Angeles</option>
                    <option>Asia/Dubai</option><option>Asia/Singapore</option>
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Note for the queue</label>
                <textarea
                  rows={3}
                  value={awayMessage}
                  onChange={(e) => setAwayMessage(e.target.value)}
                  className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                />
              </div>
              </>
              )}
            </Card>
          </section>

          {/* Behaviour toggles */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Zap size={15} className="text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Behaviour</h2>
            </div>
            <Card>
              <ToggleRow label="Require closure note" description="Agents must add a note before marking a conversation as resolved" value={settings.requireClosureNote} onChange={() => toggle('requireClosureNote')} />
              <ToggleRow label="CSAT survey on resolve" description="Trigger the CSAT survey workflow automatically after resolution" value={settings.csatOnResolve} onChange={() => toggle('csatOnResolve')} />
              <ToggleRow label="Notify on escalation" description="Send a Slack/email notification when a conversation is escalated" value={settings.notifyOnEscalation} onChange={() => toggle('notifyOnEscalation')} />
              <ToggleRow label="Show typing indicator" description="Display typing status to the customer while agents type a reply" value={settings.showTypingIndicator} onChange={() => toggle('showTypingIndicator')} />
              <ToggleRow label="Allow contact merging" description="Agents can merge duplicate contact records" value={settings.allowContactMerge} onChange={() => toggle('allowContactMerge')} />
            </Card>
          </section>

          {/* Canned responses */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare size={15} className="text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Canned Responses</h2>
            </div>
            <Card>
              <div className="space-y-2">
                {[
                  { shortcut: '/greet', text: 'Hi there! Welcome to Acme Support. How can I help you today?' },
                  { shortcut: '/thanks', text: 'Thank you for reaching out! Is there anything else I can help with?' },
                  { shortcut: '/wait', text: 'Bear with me for a moment while I look into this for you.' },
                  { shortcut: '/resolve', text: 'Great, I\'m glad we could resolve this. Have a wonderful day!' },
                ].map((cr) => (
                  <div key={cr.shortcut} className="flex items-start gap-3 p-2.5 rounded-[var(--radius-md)] border border-[var(--border)] hover:bg-[var(--bg-hover)]">
                    <span className="text-xs font-mono font-semibold text-[var(--accent)] bg-[var(--accent-muted)] px-1.5 py-0.5 rounded shrink-0">{cr.shortcut}</span>
                    <p className="text-xs text-[var(--text-secondary)] flex-1">{cr.text}</p>
                  </div>
                ))}
                <button className="text-xs text-[var(--accent)] hover:underline mt-1">+ Add canned response</button>
              </div>
            </Card>
          </section>

        </div>
      </div>
    </div>
  )
}
