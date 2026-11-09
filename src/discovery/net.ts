/** Low-level network helpers: subnet detection, CIDR expansion, TCP probing. */

import * as os from 'node:os'
import * as net from 'node:net'

/**
 * Interface names that never lead to a LAN model service:
 * Hyper-V/WSL switches, container bridges, VPN/tunnel adapters, VM host-only nets.
 * Windows APIPA addresses (`169.254.0.0/16`) are filtered separately by address.
 */
const VIRTUAL_IFACE = /^(vEthernet|VMware|VirtualBox|vboxnet|Hyper-V|WSL|docker|br-|veth|virbr|utun|tun|tap|tailscale|zt|ZeroTier|Loopback|Npcap)/i

/** 169.254.0.0/16 (IPv4 link-local / APIPA) is never a routable LAN segment. */
export function isLinkLocal(ip: string): boolean {
  return ip.startsWith('169.254.')
}

/** Cidrs wider than this are narrowed to the /24 that contains the address. */
const MAX_AUTO_PREFIX = 23

/** Canonicalize `address/prefix` to its network address; narrow overly wide prefixes to /24. */
function networkCidr(ip: string, prefix: number): string {
  const bits = prefix < MAX_AUTO_PREFIX ? 24 : prefix
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return `${intToIp((ipToInt(ip) & mask) >>> 0)}/${bits}`
}

/**
 * Pick the CIDRs a scan should sweep from a network-interface table.
 *
 * A full sweep costs `hosts × ports` TCP probes, so auto-detection must stay small:
 * - loopback / link-local (169.254/16) are skipped;
 * - virtual switches, container bridges and VPN adapters are skipped by name;
 * - a prefix wider than /23 (e.g. a Hyper-V /20 or a real /16 LAN) is narrowed to
 *   the /24 containing the address. Explicit `cidr` arguments from the tool are
 *   still expanded literally, so a genuine wide LAN can be requested by hand.
 */
export function selectScanCidrs(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[] {
  const cidrs = new Set<string>()
  for (const [name, list] of Object.entries(ifaces)) {
    if (VIRTUAL_IFACE.test(name)) continue
    for (const addr of list ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      if (isLinkLocal(addr.address)) continue
      if (!addr.cidr) continue
      const prefix = Number(addr.cidr.split('/')[1])
      if (Number.isNaN(prefix)) continue
      cidrs.add(networkCidr(addr.address, prefix))
    }
  }
  return [...cidrs]
}

/** Detect local IPv4 CIDRs worth scanning (see {@link selectScanCidrs}). */
export function detectLocalCidrs(): string[] {
  return selectScanCidrs(os.networkInterfaces())
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
