import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { DOCKER_SOCKET, dockerRequest, dockerTarget } from './docker.js'

test('the API reads the socket unless DOCKER_PROXY_URL names a proxy', () => {
  assert.deepEqual(dockerTarget({}), { kind: 'socket', socketPath: DOCKER_SOCKET })
  assert.deepEqual(dockerTarget({ DOCKER_PROXY_URL: '  ' }), { kind: 'socket', socketPath: DOCKER_SOCKET })
  assert.deepEqual(dockerTarget({ DOCKER_PROXY_URL: 'not a url' }), { kind: 'socket', socketPath: DOCKER_SOCKET })
  assert.deepEqual(dockerTarget({ DOCKER_PROXY_URL: 'http://docker-proxy:2375' }), { kind: 'proxy', host: 'docker-proxy', port: 2375 })
  assert.deepEqual(dockerTarget({ DOCKER_PROXY_URL: 'tcp://docker-proxy' }), { kind: 'proxy', host: 'docker-proxy', port: 2375 })
})

test('dockerRequest lists containers through the proxy and returns null when it refuses', async () => {
  const seen: string[] = []
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`)
    if (req.url?.startsWith('/containers/json')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify([{ Id: 'abc', Names: ['/botstudio-api'], State: 'running' }]))
      return
    }
    res.writeHead(403)
    res.end('Forbidden')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const target = dockerTarget({ DOCKER_PROXY_URL: `http://127.0.0.1:${port}` })
  try {
    assert.deepEqual(await dockerRequest('/containers/json?all=1', target), [{ Id: 'abc', Names: ['/botstudio-api'], State: 'running' }])
    assert.equal(await dockerRequest('/images/json', target), null)
    assert.deepEqual(seen, ['GET /containers/json?all=1', 'GET /images/json'])
  } finally {
    server.close()
  }
})

test('dockerRequest returns null when nothing is listening', async () => {
  assert.equal(await dockerRequest('/containers/json', { kind: 'socket', socketPath: '/nonexistent/docker.sock' }), null)
  assert.equal(await dockerRequest('/containers/json', { kind: 'proxy', host: '127.0.0.1', port: 1 }), null)
})
