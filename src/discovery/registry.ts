/** Scan orchestration: CIDR sweep + static hosts, TTL cache, node pickers. */

import type { ServiceRecord } from '../types.js'
import { detectLocalCidrs, expandCidr, mapLimit, tcpProbe } from './net.js'
import { probeService } from './probes.js'

export interface StaticHost {
  url: string
  alias?: string
  /** Optional expected kind; when omitted the service is fingerprinted. */
  kind?: ServiceRecord['kind']
}

export interface RegistryOptions {
  /** Extra CIDRs to scan in addition to auto-detected local subnets. Empty = auto only. */
  cidrs?: string[]
  /** Replace auto-detection entirely when set. */
  cidrsOnly?: string[]
  ports?: number[]
  tcpTimeoutMs?: number
  httpTimeoutMs?: number
  concurrency?: number
  staticHosts?: StaticHost[]
  cacheTtlMs?: number
  /** Hard upper bound for one sweep; unprobed targets are reported as truncated. */
  scanDeadlineMs?: number
}

export const DEFAULT_PORTS = [8000, 8080, 8188, 8888, 11434, 1234, 7860, 9997]

/** Upper bound on (host × port) pairs one sweep may build, guards hand-written /16s. */
const MAX_TARGETS = 50_000

export interface ScanMeta {
  /** CIDRs actually swept by the last scan. */
  cidrs: string[]
  /** Host × port pairs queued / probed. */
  targets: number
  /** True when the deadline or MAX_TARGETS cut the sweep short. */
  truncated: boolean
  /** Wall-clock cost of the last scan. */
  tookMs: number
}

export class LanRegistry {
  private opts: Required<Pick<RegistryOptions, 'ports' | 'tcpTimeoutMs' | 'httpTimeoutMs' | 'concurrency' | 'cacheTtlMs' | 'scanDeadlineMs'>> &
    RegistryOptions
  private cache: ServiceRecord[] | null = null
  private cacheAt = 0
  private scanning: Promise<ServiceRecord[]> | null = null
  private meta: ScanMeta = { cidrs: [], targets: 0, truncated: false, tookMs: 0 }

  constructor(opts: RegistryOptions = {}) {
    this.opts = {
      ports: opts.ports ?? DEFAULT_PORTS,
      tcpTimeoutMs: opts.tcpTimeoutMs ?? 400,
      httpTimeoutMs: opts.httpTimeoutMs ?? 2500,
      concurrency: opts.concurrency ?? 64,
      cacheTtlMs: opts.cacheTtlMs ?? 60_000,
      scanDeadlineMs: opts.scanDeadlineMs ?? 120_000,
      ...opts,
    }
  }

  /** What the last scan covered — lets the caller report a truncated sweep. */
  get scanMeta(): ScanMeta {
    return this.meta
  }

  /** Full scan (cached for cacheTtlMs unless refresh=true). */
  async scan(params: { refresh?: boolean; cidr?: string } = {}): Promise<ServiceRecord[]> {
    if (!params.refresh && this.cache && Date.now() - this.cacheAt < this.opts.cacheTtlMs) return this.cache
    if (this.scanning) return this.scanning
    this.scanning = this.doScan(params.cidr).finally(() => (this.scanning = null))
    const records = await this.scanning
    this.cache = records
    this.cacheAt = Date.now()
    return records
  }

  private async doScan(extraCidr?: string): Promise<ServiceRecord[]> {
    const started = Date.now()
    const deadline = started + this.opts.scanDeadlineMs
    // `cidrsOnly` set (even to []) disables auto-detection entirely.
    const cidrs =
      this.opts.cidrsOnly !== undefined
        ? [...this.opts.cidrsOnly, ...(extraCidr ? [extraCidr] : [])]
        : [...detectLocalCidrs(), ...(this.opts.cidrs ?? []), ...(extraCidr ? [extraCidr] : [])]
    const hosts = new Set<string>()
    for (const cidr of cidrs) {
      try {
        for (const h of expandCidr(cidr)) hosts.add(`${h}`)
      } catch {
        // invalid cidr configured — skip rather than fail the whole scan
      }
    }
    const targets: { host: string; port: number }[] = []
    let capped = false
    outer: for (const host of hosts) {
      for (const port of this.opts.ports) {
        if (targets.length >= MAX_TARGETS) {
          capped = true
          break outer
        }
        targets.push({ host, port })
      }
    }

    // Every probe is also bounded by what is left of the sweep deadline, so a slow
    // segment degrades into partial results instead of an apparently hung tool call.
    const open = await mapLimit(targets, this.opts.concurrency, async (t) => {
      const left = deadline - Date.now()
      if (left <= 0) return false
      return tcpProbe(t.host, t.port, Math.min(this.opts.tcpTimeoutMs, Math.max(50, left)))
    })
    const openTargets = targets.filter((_, i) => open[i])

    const found = await mapLimit(openTargets, 8, async (t) => {
      const left = deadline - Date.now()
      if (left <= 0) return null
      const hit = await probeService(t.host, t.port, Math.min(this.opts.httpTimeoutMs, Math.max(200, left)))
      if (!hit) return null
      const loopback = t.host === '127.0.0.1' || t.host === 'localhost' || t.host === '::1'
      const record: ServiceRecord = {
        key: `http://${t.host}:${t.port}`,
        host: t.host,
        port: t.port,
        kind: hit.kind,
        software: hit.software,
        loopback,
        status: 'up',
        models: hit.models,
        meta: hit.meta,
        source: 'scan',
        probedAt: Date.now(),
      }
      return record
    })

    // Static hosts: always merged in (they may be loopback-bound and thus unscannable).
    const statics = await mapLimit(this.opts.staticHosts ?? [], 8, async (s) => this.probeStatic(s))
    const byKey = new Map<string, ServiceRecord>()
    for (const r of [...found, ...statics]) {
      if (r) byKey.set(r.key, r)
    }
    this.meta = {
      cidrs,
      targets: targets.length,
      truncated: capped || Date.now() >= deadline,
      tookMs: Date.now() - started,
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
  }

  private async probeStatic(s: StaticHost): Promise<ServiceRecord> {
    let url: URL
    try {
      url = new URL(s.url)
    } catch {
      return this.deadStatic(s, `invalid url: ${s.url}`)
    }
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    const base: ServiceRecord = {
      key: `${url.protocol}//${url.host}`,
      host: url.hostname,
      port: Number(url.port) || 80,
      kind: s.kind ?? 'unknown',
      alias: s.alias,
      loopback,
      status: 'unknown',
      models: [],
      source: 'static',
    }
    try {
      const hit = await probeService(url.hostname, Number(url.port) || 80, this.opts.httpTimeoutMs)
      if (!hit) return { ...base, status: 'down', error: 'no known model service answered' }
      return { ...base, kind: hit.kind, software: hit.software, models: hit.models, meta: hit.meta, status: 'up', probedAt: Date.now() }
    } catch (err) {
      return this.deadStatic(s, err instanceof Error ? err.message : String(err))
    }
  }

  private deadStatic(s: StaticHost, error: string): ServiceRecord {
    let host = s.url
    let port = 80
    try {
      const u = new URL(s.url)
      host = u.hostname
      port = Number(u.port) || 80
    } catch {
      /* keep defaults */
    }
    return {
      key: s.url,
      host,
      port,
      kind: s.kind ?? 'unknown',
      alias: s.alias,
      loopback: ['127.0.0.1', 'localhost', '::1'].includes(host),
      status: 'down',
      models: [],
      source: 'static',
      error,
    }
  }

  /** Re-probe a single service URL for detailed status. */
  async statusOf(key: string): Promise<ServiceRecord> {
    const u = new URL(key)
    const hit = await probeService(u.hostname, Number(u.port) || 80, this.opts.httpTimeoutMs)
    if (!hit) {
      return {
        key,
        host: u.hostname,
        port: Number(u.port) || 80,
        kind: 'unknown',
        loopback: ['127.0.0.1', 'localhost', '::1'].includes(u.hostname),
        status: 'down',
        models: [],
        source: 'static',
        error: 'no known model service answered',
      }
    }
    return {
      key,
      host: u.hostname,
      port: Number(u.port) || 80,
      kind: hit.kind,
      software: hit.software,
      loopback: ['127.0.0.1', 'localhost', '::1'].includes(u.hostname),
      status: 'up',
      models: hit.models,
      meta: hit.meta,
      source: 'static',
      probedAt: Date.now(),
    }
  }

  /** Pick a ComfyUI node: by alias or URL substring, else the first up node. */
  pickComfyUI(records: ServiceRecord[], pref?: string): ServiceRecord | undefined {
    const comfy = records.filter((r) => r.kind === 'comfyui' && r.status === 'up')
    if (!comfy.length) return undefined
    if (pref) {
      const p = pref.toLowerCase()
      const match = comfy.find((r) => r.alias?.toLowerCase() === p || r.key.toLowerCase().includes(p) || r.host === p)
      if (match) return match
    }
    // Prefer non-loopback nodes (a LAN peer is usually the beefier box), fall back to local.
    return comfy.find((r) => !r.loopback) ?? comfy[0]
  }

  /** Pick an OpenAI-compatible LLM endpoint, optionally filtering by model id substring. */
  pickOpenAI(records: ServiceRecord[], pref?: string, model?: string): { record: ServiceRecord; model: string } | undefined {
    const pool = records.filter((r) => r.kind === 'openai' && r.status === 'up' && r.models.length > 0)
    const candidates = pref
      ? pool.filter((r) => r.alias?.toLowerCase() === pref.toLowerCase() || r.key.toLowerCase().includes(pref.toLowerCase()) || r.host === pref)
      : pool
    const list = candidates.length ? candidates : pool
    for (const r of list) {
      if (model) {
        const m = r.models.find((m) => m.id.toLowerCase().includes(model.toLowerCase()))
        if (m) return { record: r, model: m.id }
      } else {
        return { record: r, model: r.models[0].id }
      }
    }
    return undefined
  }
}
