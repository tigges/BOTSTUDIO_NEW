import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { handoverSoundOn, titleWithCount, waitingChatId } from './handover-alert'
import { useTenantWS } from './ws'

let audio: AudioContext | null = null

/** Two short rising notes. Browsers only allow sound after the page has been used; otherwise it stays silent. */
function playTone() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    audio ??= new Ctx()
    if (audio.state === 'suspended') void audio.resume()
    const start = audio.currentTime
    for (const [offset, frequency] of [[0, 660], [0.16, 880]] as const) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.14)
      osc.connect(gain).connect(audio.destination)
      osc.start(start + offset)
      osc.stop(start + offset + 0.15)
    }
  } catch { /* no audio in this browser */ }
}

/**
 * Chats handed to a person since the team last looked at Chats. Rings once per chat,
 * counts in the tab title, and clears while Chats is open in a visible tab.
 */
export function useHandoverAlert(onChats: boolean): number {
  const { subscribe } = useTenantWS()
  const qc = useQueryClient()
  const [waiting, setWaiting] = useState<string[]>([])
  const rung = useRef(new Set<string>())
  const onChatsRef = useRef(onChats)
  onChatsRef.current = onChats

  useEffect(() => subscribe((evt) => {
    const id = waitingChatId(evt)
    if (!id || rung.current.has(id)) return
    rung.current.add(id)
    void qc.invalidateQueries({ queryKey: ['conversations'] })
    if (handoverSoundOn()) playTone()
    if (onChatsRef.current && document.visibilityState === 'visible') return
    setWaiting((ids) => ids.includes(id) ? ids : [...ids, id])
  }), [subscribe, qc])

  useEffect(() => {
    if (!onChats) return
    const clear = () => { if (document.visibilityState === 'visible') setWaiting([]) }
    clear()
    document.addEventListener('visibilitychange', clear)
    return () => document.removeEventListener('visibilitychange', clear)
  }, [onChats])

  useEffect(() => {
    document.title = titleWithCount(document.title, waiting.length)
  }, [waiting.length])

  return waiting.length
}
