/** Low-level network helpers: subnet detection, CIDR expansion, TCP probing. */

import * as os from 'node:os'
import * as net from 'node:net'

/** Detect local IPv4 CIDRs (excluding loopback / virtual-ish interfaces via `internal`). */
export function detectLocalCidrs(): string[] {
  const cidrs = new Set<string>()
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      if (addr.cidr) cidrs.add(addr.cidr)
    }
  }
  return [...cidrs]
}

function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`invalid IPv4 address: ${ip}`)
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function intToIp(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 0xff).join('.')
}

/**
 * Expand a CIDR (IPv4) to its usable host addresses.
 * For prefixes <= 30 the network and broadcast addresses are skipped;
 * /31 and /32 return both/one address as-is. Prefixes below /16 are
 * rejected to keep scan ranges bounded.
 */
export function expandCidr(cidr: string): string[] {
  const [ip, prefixStr] = cidr.split('/')
  const prefix = Number(prefixStr)
  if (!ip || Number.isNaN(prefix) || prefix < 16 || prefix > 32) {
    throw new Error(`unsupported CIDR (must be /16../32): ${cidr}`)
  }
  const base = ipToInt(ip)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (base & mask) >>> 0
  const size = 2 ** (32 - prefix)
  const hosts: string[] = []
  const first = prefix <= 30 ? network + 1 : network
  const last = prefix <= 30 ? network + size - 2 : network + size - 1
  for (let n = first; n <= last; n++) hosts.push(intToIp(n))
  return hosts
}

/** Probe a single TCP port with a connection timeout. Resolves true/false, never rejects. */
export function tcpProbe(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, host)
  })
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}
