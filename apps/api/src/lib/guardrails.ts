import { prisma } from '@botstudio/db'
import { parseGuardrailRules, type GuardrailRule, type PrivacySettings } from '@botstudio/shared'
import { loadPrivacy } from './privacy.js'

const TTL_MS = 30_000
const cache = new Map<string, { rules: GuardrailRule[]; at: number }>()

/** The rules of the bot's one active policy; none when no policy is active. */
export async function activeGuardrails(botId: string): Promise<GuardrailRule[]> {
  const cached = cache.get(botId)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rules
  const row = await prisma.guardrailPolicy.findFirst({ where: { botId, active: true }, select: { rules: true } }).catch(() => null)
  const rules = parseGuardrailRules(row?.rules).filter((rule) => rule.enabled)
  cache.set(botId, { rules, at: Date.now() })
  return rules
}

export function forgetGuardrails(botId: string): void {
  cache.delete(botId)
}

export interface TurnSafety {
  rules: GuardrailRule[]
  privacy: PrivacySettings
}

export async function turnSafety(botId: string): Promise<TurnSafety> {
  const [rules, privacy] = await Promise.all([activeGuardrails(botId), loadPrivacy(botId)])
  return { rules, privacy }
}
