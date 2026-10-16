import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@ybot/ui'
import { BELLA_SAMPLE, suggestionFromRated, suggestionFromSamples, type LearnSuggestion, type RatedChatInput } from '@ybot/shared'
import { learn, type LearnCard, type LearnSnapshot } from '../../lib/api'
import { useLearning } from '../../lib/hooks'
import { useAppStore } from '../../store/app'

const isDemoMode = () => import.meta.env.VITE_DEMO_MODE === 'true'

const EMPTY_WEEK = { finished: 0, helpful: 0, notHelpful: 0 }

function demoRatedChats(): RatedChatInput[] {
  const colour = Array.from({ length: 7 }, () => ({
    rating: 1,
    visitorLines: ['Can I book a colour?'],
    botLines: ['What would you like done? A cut, colour, or something else is fine.'],
  }))
  const other = Array.from({ length: 4 }, (_, index) => ({
    rating: 1,
    visitorLines: [`opening hours ${index}`],
    botLines: ['Monday to Saturday, 09:00 to 18:00.'],
  }))
  return [
    ...colour,
    ...other,
    { rating: -1, visitorLines: ['hello'], botLines: ['Hi.'] },
    { rating: -1, visitorLines: ['prices'], botLines: ['How can I help?'] },
  ]
}

function cardFromSuggestion(suggestion: LearnSuggestion): LearnCard {
  return {
    flowId: 'demo-learned',
    version: 1,
    phrase: suggestion.phrase,
    sentence: suggestion.sentence,
    fromLabel: suggestion.fromLabel,
    keeps: suggestion.keeps,
    preview: suggestion.preview,
  }
}

export function LearnFromChats({
  botName,
  envLabel,
  environmentId,
  sandboxId,
}: {
  botName: string
  envLabel: string
  environmentId: string
  sandboxId: string
}) {
  const demo = isDemoMode()
  const bid = useAppStore((s) => s.selectedBotId ?? '')
  const queryClient = useQueryClient()
  const live = useLearning(demo ? '' : environmentId)
  const [local, setLocal] = useState<LearnSnapshot | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [published, setPublished] = useState('')

  const snapshot = local ?? (demo ? null : live.data ?? null)
  const week = snapshot?.week ?? EMPTY_WEEK
  const suggestion = published ? null : snapshot?.suggestion ?? null
  const note = snapshot?.note

  async function refresh(next: LearnSnapshot) {
    setLocal(next)
    setPublished('')
    if (!demo) {
      await queryClient.invalidateQueries({ queryKey: ['learn', bid] })
      await queryClient.invalidateQueries({ queryKey: ['flows', bid] })
    }
  }

  async function pasteSamples() {
    setError('')
    if (!text.trim()) {
      setError('Paste a full chat that includes what the visitor asked for.')
      return
    }
    if (demo) {
      const suggestion = suggestionFromSamples(text, botName)
      if (!suggestion) {
        setError('Paste a full chat that includes what the visitor asked for.')
        return
      }
      setLocal({ week, suggestion: cardFromSuggestion(suggestion), note: null })
      setPublished('')
      setPasteOpen(false)
      return
    }
    setBusy('paste')
    try {
      const result = await learn.samples(bid, environmentId, text)
      await refresh(result.data)
      if (result.data.suggestion) setPasteOpen(false)
      else setError(result.data.note ?? 'Paste a full chat that includes what the visitor asked for.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read those chats.')
    } finally {
      setBusy('')
    }
  }

  async function readRated() {
    setError('')
    if (demo) {
      const chats = demoRatedChats()
      const suggestion = suggestionFromRated(chats, botName)
      setLocal({
        week: { finished: 18, helpful: 11, notHelpful: 2 },
        suggestion: suggestion ? cardFromSuggestion(suggestion) : null,
        note: suggestion ? null : 'No repeated request in the helpful chats yet.',
      })
      setPublished('')
      return
    }
    setBusy('rated')
    try {
      const result = await learn.rated(bid, environmentId)
      await refresh(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the rated chats.')
    } finally {
      setBusy('')
    }
  }

  async function publish() {
    if (!suggestion) return
    setError('')
    if (demo) {
      setPublished('Published to Sandbox. Production is unchanged.')
      return
    }
    if (!sandboxId) {
      setError('This bot has no Sandbox yet.')
      return
    }
    setBusy('publish')
    try {
      await learn.publish(bid, suggestion.flowId, sandboxId)
      setPublished('Published to Sandbox. Production is unchanged.')
      setLocal(null)
      await queryClient.invalidateQueries({ queryKey: ['learn', bid] })
      await queryClient.invalidateQueries({ queryKey: ['flows', bid] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish this draft.')
    } finally {
      setBusy('')
    }
  }

  async function dismiss() {
    if (!suggestion) return
    setError('')
    if (demo) {
      setLocal({ week, suggestion: null, note: null })
      return
    }
    setBusy('dismiss')
    try {
      await learn.dismiss(bid, suggestion.flowId)
      setLocal(null)
      await queryClient.invalidateQueries({ queryKey: ['learn', bid] })
      await queryClient.invalidateQueries({ queryKey: ['flows', bid] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not dismiss this draft.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <p className="text-sm font-medium text-[var(--text-primary)]">{botName || 'This bot'} · {envLabel}</p>
      <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">Learn from chats</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">Sample chats and helpful ratings draft a shorter chart. That draft is the copy guests hear.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => { setError(''); setPasteOpen(true) }}>Paste sample chats</Button>
        <Button size="sm" variant="secondary" disabled={busy === 'rated'} onClick={() => { void readRated() }}>
          {busy === 'rated' ? 'Reading…' : 'Read rated chats'}
        </Button>
      </div>
      <p className="mt-4 text-xs font-medium text-[var(--text-muted)]">This week</p>
      <p className="text-sm text-[var(--text-secondary)]">{week.finished} finished · {week.helpful} helpful · {week.notHelpful} not helpful</p>
      {note && !suggestion && <p className="mt-2 text-xs text-[var(--text-secondary)]">{note}</p>}
      {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
      {published && <p className="mt-3 text-sm text-[var(--text-secondary)]">{published}</p>}
      {suggestion && (
        <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-3">
          <p className="text-xs font-medium text-[var(--text-muted)]">Suggested draft · not live</p>
          <p className="mt-1 text-sm text-[var(--text-primary)]">{suggestion.sentence}</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{suggestion.fromLabel}</p>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">Keeps: {suggestion.keeps}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPreviewOpen(true)}>Preview the chat</Button>
            <Button size="sm" disabled={busy === 'publish' || (!demo && !sandboxId)} onClick={() => { void publish() }}>
              {busy === 'publish' ? 'Publishing…' : 'Publish to Sandbox'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy === 'dismiss'} onClick={() => { void dismiss() }}>
              {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={pasteOpen} onOpenChange={(open) => { if (!open) setPasteOpen(false) }}>
        <DialogContent size="lg">
          <DialogHeader><DialogTitle>Paste sample chats</DialogTitle></DialogHeader>
          <DialogBody className="space-y-3">
            <p className="text-sm text-[var(--text-secondary)]">Paste two or three full chats. A line of dashes starts the next chat. The draft uses the request they repeat, and it leaves out names, email addresses, and payment details.</p>
            <textarea
              rows={12}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            />
            {error && pasteOpen && <p className="text-xs text-[var(--danger)]">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPasteOpen(false)}>Cancel</Button>
            <Button variant="secondary" onClick={() => setText(BELLA_SAMPLE)}>Use the Bella sample</Button>
            <Button disabled={busy === 'paste'} onClick={() => { void pasteSamples() }}>
              {busy === 'paste' ? 'Creating…' : 'Create draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={(open) => { if (!open) setPreviewOpen(false) }}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>Preview the chat</DialogTitle></DialogHeader>
          <DialogBody className="space-y-2">
            {(suggestion?.preview ?? []).map((line, index) => (
              <div key={`${line.role}-${index}`} className={line.role === 'visitor' ? 'flex justify-end' : 'flex justify-start'}>
                <p className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-primary)]">{line.text}</p>
              </div>
            ))}
            {suggestion && <p className="pt-2 text-xs text-[var(--text-secondary)]">Keeps: {suggestion.keeps}</p>}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
