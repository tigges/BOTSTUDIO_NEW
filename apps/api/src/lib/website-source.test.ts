import assert from 'node:assert/strict'
import { test } from 'node:test'
import { siteHost } from './install-blueprint.js'

test('one website is one Knowledge source, however its address is written', () => {
  assert.equal(siteHost('https://www.Harbour.example/fees'), 'harbour.example')
  assert.equal(siteHost('harbour.example'), 'harbour.example')
  assert.equal(siteHost('http://harbour.example:8080/'), 'harbour.example')
  assert.equal(siteHost(''), null)
  assert.equal(siteHost('not a url at all'), null)
})
