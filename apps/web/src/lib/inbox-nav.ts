let queuedChat: string | null = null
let queuedContact: string | null = null
let chatPasses = 0
let contactPasses = 0

function remember(key: string, id: string, slot: 'chat' | 'contact') {
  if (slot === 'chat') {
    queuedChat = id
    chatPasses = 0
  } else {
    queuedContact = id
    contactPasses = 0
  }
  sessionStorage.setItem(key, id)
}

function peek(slot: 'chat' | 'contact', key: string) {
  return (slot === 'chat' ? queuedChat : queuedContact) ?? sessionStorage.getItem(key)
}

function finish(slot: 'chat' | 'contact', key: string, id: string) {
  if (slot === 'chat' && queuedChat === id) queuedChat = null
  if (slot === 'contact' && queuedContact === id) queuedContact = null
  if (sessionStorage.getItem(key) === id) sessionStorage.removeItem(key)
}

/** Dev strict mode runs the inbox effect twice. Keep the id until the second pass. */
function shouldRelease(passes: number) {
  return !import.meta.env.DEV || passes >= 2
}

export function queueChat(id: string) {
  remember('botstudio-open-chat', id, 'chat')
}

export function claimChat() {
  const id = peek('chat', 'botstudio-open-chat')
  if (!id) return null
  chatPasses += 1
  if (shouldRelease(chatPasses)) finish('chat', 'botstudio-open-chat', id)
  return id
}

export function queueContact(id: string) {
  remember('botstudio-open-contact', id, 'contact')
}

export function claimContact() {
  const id = peek('contact', 'botstudio-open-contact')
  if (!id) return null
  contactPasses += 1
  if (shouldRelease(contactPasses)) finish('contact', 'botstudio-open-contact', id)
  return id
}
