import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export type Lookup = (host: string) => Promise<string[]>

export const defaultLookup: Lookup = async (host) => (await dnsLookup(host, { all: true })).map((entry) => entry.address)

export class BlockedAddressError extends Error {}

function privateV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip)
  const lower = ip.toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped) return privateV4(mapped[1]!)
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')
}

export function privateNetworkAllowed(): boolean {
  return process.env['TOOLS_ALLOW_PRIVATE_NETWORK'] === 'true'
}

/** Tools may only call public addresses, so a tool cannot reach the database, Redis or cloud metadata. */
export async function assertPublicUrl(raw: string, lookup: Lookup = defaultLookup): Promise<URL> {
  let url: URL
  try { url = new URL(raw) } catch { throw new BlockedAddressError('URL: this is not a valid address.') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BlockedAddressError('URL: only http and https addresses can be called.')
  if (privateNetworkAllowed()) return url
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [host] : await lookup(host).catch(() => { throw new BlockedAddressError(`URL: ${host} could not be found.`) })
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new BlockedAddressError(`URL: ${host} points at a private network address. Tools can only call public addresses.`)
  }
  return url
}
