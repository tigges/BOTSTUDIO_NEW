import { sendEmail } from './email.js'
import { sendText as sendWhatsAppText } from './whatsapp-client.js'
import { parseChannelConfig } from '@ybot/shared'

export async function sendChannelReply(kind: string, config: unknown, to: string, text: string): Promise<void> {
  const parsed = parseChannelConfig(kind, config)
  if (!parsed || !text.trim() || !to.trim()) return
  if (kind === 'whatsapp') {
    await sendWhatsAppText({
      phoneNumberId: parsed['phoneNumberId'] ?? '',
      accessToken: parsed['accessToken'] ?? '',
      verifyToken: parsed['verifyToken'] ?? '',
    }, to, text)
    return
  }
  if (kind === 'telegram') {
    const token = parsed['botToken'] ?? ''
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: to, text }),
    })
    if (!res.ok) throw new Error(`Telegram send HTTP ${res.status}`)
    return
  }
  if (kind === 'sms') {
    const sid = parsed['accountSid'] ?? ''
    const auth = parsed['authToken'] ?? ''
    const from = parsed['fromNumber'] ?? ''
    const body = new URLSearchParams({ To: to, From: from, Body: text })
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`Twilio SMS send HTTP ${res.status}`)
    return
  }
  if (kind === 'email') {
    await sendEmail({
      to,
      subject: 'A reply from the studio',
      text,
      html: `<p>${escapeHtml(text).replace(/\n/g, '<br/>')}</p>`,
    })
  }
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function twimlMessage(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(clip(text, 1600))}</Message></Response>`
}

export function twimlGather(say: string, action: string): string {
  const prompt = xmlEscape(clip(say, 3500))
  const url = xmlEscape(action)
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech dtmf" action="${url}" method="POST" timeout="6" speechTimeout="auto"><Say>${prompt}</Say></Gather><Say>I did not catch that. Goodbye.</Say></Response>`
}

export function twimlHangup(say: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xmlEscape(clip(say, 500))}</Say><Hangup/></Response>`
}

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
