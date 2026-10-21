/**
 * YBot embeddable chat widget.
 *
 * Usage:
 *   <script src="https://your-server.com/api/v1/widget.js?id=CHANNEL_ID" async></script>
 *
 * OR manually:
 *   <script>window.YBotChannelId = 'CHANNEL_ID';</script>
 *   <script src="https://your-server.com/api/v1/widget.js" async></script>
 */

(function () {
  // ── Config ─────────────────────────────────────────────────────────────────
  const script = (document.currentScript || document.querySelector('script[src*="widget.js"]')) as HTMLScriptElement | null
  const channelId = ((): string => {
    if (script) {
      try {
        const u = new URL(script.src)
        const id = u.searchParams.get('id') ?? u.searchParams.get('channelId') ?? ''
        if (id) return id
      } catch { /* fallthrough */ }
    }
    return (window as unknown as Record<string, unknown>)['YBotChannelId'] as string ?? ''
  })()

  if (!channelId) {
    console.warn('[YBot Widget] No channelId — add ?id=YOUR_CHANNEL_ID to the script src.')
    return
  }

  const API_BASE = ((): string => {
    if (script) {
      try {
        const u = new URL(script.src)
        return `${u.protocol}//${u.host}/api/v1`
      } catch { /* fallthrough */ }
    }
    return '/api/v1'
  })()

  const ACCENT = (window as unknown as Record<string, string>)['YBotAccentColor'] ?? '#6366f1'
  const TITLE  = (window as unknown as Record<string, string>)['YBotTitle']       ?? 'Chat with us'

  // ── State ──────────────────────────────────────────────────────────────────
  interface Msg { role: 'user' | 'bot'; text: string; streaming?: boolean }
  let sessionId  = `ws_${Date.now()}_${Math.random().toString(36).slice(2)}`
  let open       = false
  let messages: Msg[] = []
  let loading    = false

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function css(el: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
    Object.assign(el.style, styles)
  }

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    return node
  }

  const BOOKING_HOSTS: Record<string, string> = {
    'phorest.com': 'Phorest', 'fresha.com': 'Fresha', 'booksy.com': 'Booksy',
    'calendly.com': 'Calendly', 'setmore.com': 'Setmore', 'simplybook.me': 'SimplyBook',
    'vagaro.com': 'Vagaro', 'squareup.com': 'Square', 'square.site': 'Square',
  }

  function hostLabel(url: string): string | undefined {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
      for (const [known, label] of Object.entries(BOOKING_HOSTS)) {
        if (host === known || host.endsWith(`.${known}`)) return label
      }
    } catch { /* ignore */ }
    return undefined
  }

  function fillChat(node: HTMLElement, text: string) {
    node.textContent = ''
    const placeholders: string[] = []
    let next = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (full) => {
      placeholders.push(full)
      return `\u0000${placeholders.length - 1}\u0000`
    })
    next = next.replace(/\bBook on ([A-Za-z][\w .'-]*):\s*(https?:\/\/[^\s]+)/gi, (_all, label: string, url: string) => `[${String(label).trim()}](${url})`)
    next = next.replace(/https?:\/\/[^\s<>]+/g, (url) => {
      const cleaned = url.replace(/[),.;]+$/, '')
      const label = hostLabel(cleaned)
      return label ? `[${label}](${cleaned})` : url
    })
    next = next.replace(/\u0000(\d+)\u0000/g, (_, index: string) => placeholders[Number(index)] ?? '')
    const matcher = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
    let last = 0
    for (const match of next.matchAll(matcher)) {
      const index = match.index ?? 0
      if (index > last) node.appendChild(document.createTextNode(next.slice(last, index)))
      const link = el('a', { href: match[2] ?? '', target: '_blank', rel: 'noopener noreferrer' })
      link.textContent = match[1] ?? ''
      css(link, { color: 'inherit', textDecoration: 'underline' })
      node.appendChild(link)
      last = index + match[0].length
    }
    if (last < next.length) node.appendChild(document.createTextNode(next.slice(last)))
  }

  // ── Build UI ───────────────────────────────────────────────────────────────
  const root = el('div')
  css(root, { position: 'fixed', bottom: '24px', right: '24px', zIndex: '2147483647', fontFamily: 'system-ui,sans-serif' })

  // Bubble button
  const bubble = el('button')
  css(bubble, {
    width: '56px', height: '56px', borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: ACCENT, color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.25)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '24px', transition: 'transform .2s',
  })
  bubble.innerHTML = '💬'
  bubble.title = TITLE
  bubble.addEventListener('mouseenter', () => { bubble.style.transform = 'scale(1.1)' })
  bubble.addEventListener('mouseleave', () => { bubble.style.transform = 'scale(1)' })

  // Panel
  const panel = el('div')
  css(panel, {
    position: 'absolute', bottom: '72px', right: '0',
    width: '360px', height: '540px',
    background: '#fff', borderRadius: '16px',
    boxShadow: '0 12px 48px rgba(0,0,0,.18)',
    display: 'none', flexDirection: 'column', overflow: 'hidden',
  })

  // Header
  const header = el('div')
  css(header, {
    background: ACCENT, color: '#fff', padding: '14px 16px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: '0',
  })
  const headerTitle = el('span')
  headerTitle.textContent = TITLE
  css(headerTitle, { fontWeight: '600', fontSize: '15px' })
  const closeBtn = el('button')
  closeBtn.innerHTML = '✕'
  css(closeBtn, {
    background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
    fontSize: '16px', padding: '2px 6px', borderRadius: '4px',
    opacity: '.8',
  })
  closeBtn.addEventListener('click', () => togglePanel(false))
  header.append(headerTitle, closeBtn)

  // Messages area
  const msgArea = el('div')
  css(msgArea, { flex: '1', overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' })

  // Input area
  const inputRow = el('div')
  css(inputRow, {
    padding: '10px 12px', borderTop: '1px solid #f0f0f0',
    display: 'flex', gap: '8px', flexShrink: '0',
  })
  const textarea = el('textarea')
  textarea.placeholder = 'Type a message…'
  textarea.rows = 1
  css(textarea, {
    flex: '1', resize: 'none', border: '1px solid #e5e7eb', borderRadius: '8px',
    padding: '8px 12px', fontSize: '14px', fontFamily: 'inherit',
    outline: 'none', lineHeight: '1.4',
  })
  const sendBtn = el('button')
  sendBtn.textContent = '↑'
  css(sendBtn, {
    background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px',
    width: '36px', height: '36px', cursor: 'pointer', fontSize: '18px',
    fontWeight: 'bold', flexShrink: '0', alignSelf: 'flex-end',
  })

  inputRow.append(textarea, sendBtn)
  panel.append(header, msgArea, inputRow)
  root.append(panel, bubble)
  document.body.appendChild(root)

  // ── Render messages ────────────────────────────────────────────────────────
  function renderMessages() {
    msgArea.innerHTML = ''
    for (const m of messages) {
      const row = el('div')
      css(row, { display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' })
      const bubble = el('div')
      css(bubble, {
        maxWidth: '80%', padding: '8px 12px', borderRadius: m.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
        background: m.role === 'user' ? ACCENT : '#f3f4f6', color: m.role === 'user' ? '#fff' : '#111',
        fontSize: '14px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      })
      fillChat(bubble, m.text + (m.streaming ? '▋' : ''))
      row.appendChild(bubble)
      msgArea.appendChild(row)
    }
    msgArea.scrollTop = msgArea.scrollHeight
  }

  function addMessage(role: Msg['role'], text: string, streaming = false): number {
    messages.push({ role, text, streaming })
    renderMessages()
    return messages.length - 1
  }

  function updateMessage(idx: number, text: string, streaming = false) {
    if (messages[idx]) { messages[idx]!.text = text; messages[idx]!.streaming = streaming }
    renderMessages()
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = textarea.value.trim()
    if (!text || loading) return
    textarea.value = ''
    loading = true
    sendBtn.disabled = true

    const history = messages.slice(-10).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant' as string, content: m.text }))
    addMessage('user', text)
    const botIdx = addMessage('bot', '', true)

    try {
      const res = await fetch(`${API_BASE}/public/chat/${channelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId, history, messageId: `${sessionId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }),
      })

      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => 'Error')
        updateMessage(botIdx, `Sorry, something went wrong. (${res.status})`)
        loading = false; sendBtn.disabled = false
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let botText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const d = JSON.parse(line.slice(6)) as { chunk?: string; done?: boolean }
              if (d.chunk) { botText += d.chunk; updateMessage(botIdx, botText, true) }
              if (d.done)  { updateMessage(botIdx, botText, false) }
            } catch { /* ignore malformed SSE */ }
          }
        }
      }
      if (!botText) updateMessage(botIdx, "I'm sorry, I couldn't generate a response.", false)
    } catch (err) {
      updateMessage(botIdx, "Couldn't reach the server. Please try again.", false)
    } finally {
      loading = false
      sendBtn.disabled = false
    }
  }

  // ── Toggle ─────────────────────────────────────────────────────────────────
  function togglePanel(force?: boolean) {
    open = force !== undefined ? force : !open
    panel.style.display = open ? 'flex' : 'none'
    bubble.innerHTML = open ? '✕' : '💬'
    if (open && messages.length === 0) {
      addMessage('bot', 'Hello! 👋 How can I help you today?')
    }
    if (open) setTimeout(() => textarea.focus(), 50)
  }

  bubble.addEventListener('click', () => togglePanel())
  sendBtn.addEventListener('click', sendMessage)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  })
})()
