/**
 * Headers on every outgoing tenant webhook. Receivers built before the rename
 * check X-YBot-*, so both sets go out with the same values until tenants have
 * moved to X-BotStudio-*. Drop the legacy set in a release that says so.
 */
export function webhookHeaders(input: { event: string; deliveryId?: string; signature?: string }): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'BotStudio-Webhook/1.0',
    'X-BotStudio-Event': input.event,
    'X-YBot-Event': input.event,
  }
  if (input.deliveryId !== undefined) {
    headers['X-BotStudio-Delivery'] = input.deliveryId
    headers['X-YBot-Delivery'] = input.deliveryId
  }
  if (input.signature !== undefined) {
    headers['X-BotStudio-Signature'] = input.signature
    headers['X-YBot-Signature'] = input.signature
  }
  return headers
}
