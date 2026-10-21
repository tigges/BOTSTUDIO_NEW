import * as http from 'node:http'

export const DOCKER_SOCKET = '/var/run/docker.sock'

export type DockerTarget =
  | { kind: 'proxy'; host: string; port: number }
  | { kind: 'socket'; socketPath: string }

/**
 * DOCKER_PROXY_URL points at a read-only socket proxy (containers list only).
 * Without it the API reads the socket directly, which only works on hosts
 * that still mount /var/run/docker.sock into the API container.
 */
export function dockerTarget(env: NodeJS.ProcessEnv = process.env): DockerTarget {
  const raw = env['DOCKER_PROXY_URL']?.trim()
  if (raw) {
    try {
      const url = new URL(raw)
      if (url.protocol === 'http:' || url.protocol === 'tcp:') {
        return { kind: 'proxy', host: url.hostname, port: Number(url.port) || 2375 }
      }
    } catch {
      // fall through to the socket
    }
  }
  return { kind: 'socket', socketPath: DOCKER_SOCKET }
}

/** GET a Docker Engine API path. Resolves null on any failure. */
export function dockerRequest(path: string, target: DockerTarget = dockerTarget()): Promise<unknown> {
  return new Promise((resolve) => {
    const where = target.kind === 'proxy'
      ? { host: target.host, port: target.port }
      : { socketPath: target.socketPath }
    const req = http.request({ ...where, path, method: 'GET' }, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) return resolve(null)
        try { resolve(JSON.parse(body)) } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(3000, () => { req.destroy(); resolve(null) })
    req.end()
  })
}
