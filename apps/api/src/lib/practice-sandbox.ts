/**
 * A stand-in practice management system for the Harbour Dental reference bot,
 * so its HTTP tools return real answers during test runs and demos. Slots are
 * worked out from the date, so the same question gets the same answer; holds
 * live in memory for 15 minutes and honour the Idempotency-Key header.
 */

import { createHash } from 'node:crypto'

export const DENTAL_REF_BOT_ID = 'harbour-dental-ref'
/** The Auth Profile the reference bot's HTTP tools use; its key is the one the sandbox accepts. */
export const PRACTICE_PROFILE_NAME = 'Harbour Dental practice system'
/** Where the reference tools point until a test run moves them onto the sandbox. */
export const PRACTICE_PLACEHOLDER_BASE = 'https://pms.harbourdental.example/v1'
export const SANDBOX_PATH = '/api/v1/public/practice-sandbox/harbour-dental/v1'

export const SANDBOX_VISIT_TYPES = ['check-up', 'hygiene', 'new patient exam', 'emergency'] as const
export type SandboxVisitType = typeof SANDBOX_VISIT_TYPES[number]

const HOLD_MS = 15 * 60_000

const TIMES: Record<SandboxVisitType, string[]> = {
  'check-up': ['09:00', '10:30', '14:00', '16:15'],
  hygiene: ['08:30', '11:00', '15:30'],
  'new patient exam': ['10:00', '13:30'],
  emergency: ['08:15', '11:30'],
}

const LENGTH: Record<SandboxVisitType, number> = { 'check-up': 30, hygiene: 45, 'new patient exam': 60, emergency: 20 }
const DENTISTS = ['Dr Okafor', 'Dr Patel']

export interface SandboxSlot {
  slot_id: string
  start: string
  dentist: string
  minutes: number
}

export type SandboxResult<T> = { status: number; body: T | { error: string } }

function visitType(raw: unknown): SandboxVisitType | undefined {
  const value = String(raw ?? '').trim().toLowerCase()
  return (SANDBOX_VISIT_TYPES as readonly string[]).includes(value) ? value as SandboxVisitType : undefined
}

function parseDay(raw: unknown): Date | undefined {
  const value = String(raw ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const day = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value ? undefined : day
}

/** Free slots for a visit type on a day. Sundays are closed; Saturdays only have mornings. */
export function sandboxSlots(type: unknown, date: unknown): SandboxResult<SandboxSlot[]> {
  const kind = visitType(type)
  if (!kind) return { status: 400, body: { error: `type must be one of: ${SANDBOX_VISIT_TYPES.join(', ')}.` } }
  const day = parseDay(date)
  if (!day) return { status: 400, body: { error: 'date must be a day written as YYYY-MM-DD.' } }
  const weekday = day.getUTCDay()
  if (weekday === 0) return { status: 200, body: [] }
  const times = weekday === 6 ? TIMES[kind].filter((time) => time < '12:00') : TIMES[kind]
  const stamp = day.toISOString().slice(5, 10).replace('-', '')
  return {
    status: 200,
    body: times.map((start, index) => ({
      slot_id: `S-${stamp}-${start.replace(':', '')}`,
      start,
      dentist: DENTISTS[(index + day.getUTCDate()) % DENTISTS.length]!,
      minutes: LENGTH[kind],
    })),
  }
}

export interface SandboxHold {
  hold: string
  slot_id: string
  patient_name: string
  expires: string
}

interface HeldSlot extends SandboxHold {
  key: string
  until: number
}

/** Holds by slot. One process, so a restart frees every hold, as a real 15-minute hold would soon do anyway. */
export class SandboxHolds {
  private held = new Map<string, HeldSlot>()

  constructor(private now: () => number = Date.now) {}

  hold(body: unknown, idempotencyKey: string | undefined): SandboxResult<SandboxHold> {
    const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    const slot = String(input['slot_id'] ?? '').trim()
    const name = String(input['patient_name'] ?? '').trim()
    const phone = String(input['phone'] ?? '').trim()
    const missing = [!slot && 'slot_id', !name && 'patient_name', !phone && 'phone'].filter(Boolean)
    if (missing.length) return { status: 422, body: { error: `Missing ${missing.join(', ')}.` } }
    if (!/^S-\d{4}-\d{4}$/.test(slot)) return { status: 404, body: { error: `There is no slot ${slot}. Look it up with Find free appointment slots first.` } }
    const at = this.now()
    for (const [id, row] of this.held) if (row.until <= at) this.held.delete(id)
    const key = idempotencyKey?.trim() || `${slot}:${name}:${phone}`
    const existing = this.held.get(slot)
    if (existing) {
      if (existing.key === key) return { status: 200, body: publicHold(existing) }
      return { status: 409, body: { error: 'That slot was just taken. Pick another time.' } }
    }
    const row: HeldSlot = {
      hold: `H-${createHash('sha256').update(`${slot}|${key}`).digest('hex').slice(0, 5).toUpperCase()}`,
      slot_id: slot,
      patient_name: name,
      expires: new Date(at + HOLD_MS).toISOString(),
      key,
      until: at + HOLD_MS,
    }
    this.held.set(slot, row)
    return { status: 201, body: publicHold(row) }
  }
}

function publicHold(row: HeldSlot): SandboxHold {
  return { hold: row.hold, slot_id: row.slot_id, patient_name: row.patient_name, expires: row.expires }
}
