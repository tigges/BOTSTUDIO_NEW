import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bookingWorkflowsIn, chatParts, chatPlain, rewriteChatLinks } from '@ybot/shared'

test('a Phorest URL becomes a named link, not the raw address', () => {
  const dumped = 'Book on Phorest: https://www.phorest.com/salon/yuzuhairandbeauty'
  assert.equal(rewriteChatLinks(dumped), '[Phorest](https://www.phorest.com/salon/yuzuhairandbeauty)')
  assert.deepEqual(chatParts(dumped), [{ type: 'link', href: 'https://www.phorest.com/salon/yuzuhairandbeauty', label: 'Phorest' }])
  assert.equal(chatPlain(dumped), 'Phorest')
  assert.equal(
    chatPlain("I'll confirm this in chat. You can also open it on [Phorest](https://www.phorest.com/salon/yuzuhairandbeauty)."),
    "I'll confirm this in chat. You can also open it on Phorest.",
  )
  assert.deepEqual(
    bookingWorkflowsIn({ nodes: [{ data: { config: { text: '[Phorest](https://www.phorest.com/salon/yuzuhairandbeauty)' } } }] }),
    ['Phorest'],
  )
})
