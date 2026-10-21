import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPaletteShortcut, matchScore, paletteCommands, rankCommands, type PaletteSources } from './command-palette.ts'

const sources: PaletteSources = {
  pages: [
    { id: 'overview', label: 'Overview', path: '/overview' },
    { id: 'journey', label: 'Journey', path: '/build/journey', section: 'Build' },
    { id: 'releases', label: 'Releases', path: '/build/releases', section: 'Build' },
    { id: 'channels', label: 'Channels', path: '/configure/channels', section: 'Configure' },
  ],
  bots: [{ id: 'b1', name: 'Acme Support Bot' }, { id: 'b2', name: 'Harbour Dental' }],
  selectedBotId: 'b1',
  flows: [{ id: 'f1', name: 'Book an appointment' }, { id: 'f2', name: 'Cancel a booking' }],
  selectedEnv: 'sandbox',
  canBuild: true,
}

test('the palette covers actions, pages, bots and flows', () => {
  const commands = paletteCommands(sources)
  const groups = new Set(commands.map((cmd) => cmd.group))
  assert.deepEqual([...groups], ['Actions', 'Pages', 'Bots', 'Flows'])
  assert.ok(commands.some((cmd) => cmd.target.kind === 'path' && cmd.target.to === '/build/flows/f1'))
})

test('the current bot is not offered as a switch target', () => {
  const bots = paletteCommands(sources).filter((cmd) => cmd.group === 'Bots')
  assert.deepEqual(bots.map((cmd) => cmd.label), ['Switch to Harbour Dental'])
})

test('the environment action offers the other environment', () => {
  const inSandbox = paletteCommands(sources).find((cmd) => cmd.id === 'act-env')
  const inProduction = paletteCommands({ ...sources, selectedEnv: 'production' }).find((cmd) => cmd.id === 'act-env')
  assert.deepEqual(inSandbox?.target, { kind: 'env', env: 'production' })
  assert.deepEqual(inProduction?.target, { kind: 'env', env: 'sandbox' })
})

test('agents without build rights are not offered publishing or new bots', () => {
  const ids = paletteCommands({ ...sources, canBuild: false }).map((cmd) => cmd.id)
  assert.ok(!ids.includes('act-publish'))
  assert.ok(!ids.includes('act-new-bot'))
  assert.ok(ids.includes('act-inbox'))
})

test('a prefix beats a word prefix, which beats a substring, which beats letters in order', () => {
  assert.ok(matchScore('rel', 'Releases') > matchScore('rel', 'Go releases'))
  assert.ok(matchScore('rel', 'Go releases') > matchScore('eas', 'Releases'))
  assert.ok(matchScore('eas', 'Releases') > matchScore('rls', 'Releases'))
  assert.equal(matchScore('xyz', 'Releases'), 0)
  assert.equal(matchScore('', 'Anything'), 1)
})

test('a query ranks matches across groups, keywords included', () => {
  const ranked = rankCommands('book', paletteCommands(sources))
  assert.equal(ranked[0]?.label, 'Book an appointment')
  assert.ok(ranked.some((cmd) => cmd.label === 'Cancel a booking'))
  const deploy = rankCommands('deploy', paletteCommands(sources))
  assert.equal(deploy[0]?.id, 'act-publish')
})

test('with no query each group keeps its order and is capped', () => {
  const many = { ...sources, flows: Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, name: `Flow ${i}` })) }
  const ranked = rankCommands('', paletteCommands(many), 3)
  assert.equal(ranked.filter((cmd) => cmd.group === 'Flows').length, 3)
  assert.equal(ranked[0]?.group, 'Actions')
})

test('⌘K and Ctrl+K open the palette, plain K does not', () => {
  assert.ok(isPaletteShortcut({ key: 'k', metaKey: true, ctrlKey: false }))
  assert.ok(isPaletteShortcut({ key: 'K', metaKey: false, ctrlKey: true }))
  assert.ok(!isPaletteShortcut({ key: 'k', metaKey: false, ctrlKey: false }))
})
