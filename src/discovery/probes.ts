/** HTTP fingerprinting: identify what model service listens on an open host:port. */

import type { GpuInfo, ModelRef, ServiceKind, ServiceMeta } from '../types.js'

export interface ProbeResult {
  kind: ServiceKind
  software?: string
  models: ModelRef[]
  meta?: ServiceMeta
}

async function fetchJson(url: string, timeoutMs: number): Promise<{ status: number; json: unknown } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
    const text = await res.text()
    try {
      return { status: res.status, json: JSON.parse(text) as unknown }
    } catch {
      return null
    }
  } catch {
    return null
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function bytesToGb(n?: number): string | undefined {
  return typeof n === 'number' && n > 0 ? `${(n / 1024 ** 3).toFixed(1)}GB` : undefined
}

/** Fingerprint one open host:port. Returns null when nothing recognizable answers. */
export async function probeService(host: string, port: number, timeoutMs = 2500): Promise<ProbeResult | null> {
  const base = `http://${host}:${port}`

  // 1. ComfyUI: GET /system_stats
  const stats = await fetchJson(`${base}/system_stats`, timeoutMs)
  const statsObj = stats && stats.status === 200 ? asRecord(stats.json) : null
  if (statsObj && Array.isArray(statsObj.devices)) {
    const sys = asRecord(statsObj.system) ?? {}
    const gpus: GpuInfo[] = (statsObj.devices as unknown[]).map((d) => {
      const dev = asRecord(d) ?? {}
      return {
        name: typeof dev.name === 'string' ? dev.name : undefined,
        vramTotal: typeof dev.vram_total === 'number' ? dev.vram_total : undefined,
        vramFree: typeof dev.vram_free === 'number' ? dev.vram_free : undefined,
      }
    })
    const version = statsObj.comfyui_version
    const versions: Record<string, string> = {}
    if (typeof version === 'string') versions.comfyui = version
    if (typeof sys.os === 'string') versions.os = sys.os
    const meta: ServiceMeta = {
      gpus,
      versions,
      ramTotal: sys.ram_total as number | undefined,
      /** Model list intentionally not fetched here: /object_info is heavy, only the
       *  detailed-status / generation path pulls it. */
      modelsNote: 'use lan_model_status for the full model list',
    }
    // Queue depth is cheap and useful for coordination.
    const queue = await fetchJson(`${base}/queue`, timeoutMs)
    const queueObj = queue && queue.status === 200 ? asRecord(queue.json) : null
    if (queueObj) {
      meta.queue = {
        running: Array.isArray(queueObj.queue_running) ? queueObj.queue_running.length : 0,
        pending: Array.isArray(queueObj.queue_pending) ? queueObj.queue_pending.length : 0,
      }
    }
    return { kind: 'comfyui', software: `ComfyUI${typeof version === 'string' ? ` ${version}` : ''}`, models: [], meta }
  }

  // 2. Ollama: GET /api/tags
  const tags = await fetchJson(`${base}/api/tags`, timeoutMs)
  const tagsObj = tags && tags.status === 200 ? asRecord(tags.json) : null
  if (tagsObj && Array.isArray(tagsObj.models)) {
    const models: ModelRef[] = []
    for (const m of tagsObj.models) {
      const rec = asRecord(m)
      if (!rec || typeof rec.name !== 'string') continue
      const details = asRecord(rec.details)
      const parts = [bytesToGb(rec.size as number | undefined), details?.quantization_level as string | undefined]
        .filter(Boolean)
        .join(' ')
      models.push({ id: rec.name, detail: parts || undefined })
    }
    const ver = await fetchJson(`${base}/api/version`, timeoutMs)
    const verObj = ver && ver.status === 200 ? asRecord(ver.json) : null
    return {
      kind: 'ollama',
      software: `Ollama${verObj && typeof verObj.version === 'string' ? ` ${verObj.version}` : ''}`,
      models,
    }
  }

  // 3. OpenAI-compatible (oMLX / vLLM / LM Studio / llama.cpp / ...): GET /v1/models
  const v1 = await fetchJson(`${base}/v1/models`, timeoutMs)
  const v1Obj = v1 && v1.status === 200 ? asRecord(v1.json) : null
  if (v1Obj && Array.isArray(v1Obj.data)) {
    const models: ModelRef[] = []
    for (const m of v1Obj.data) {
      const rec = asRecord(m)
      if (rec && typeof rec.id === 'string') models.push({ id: rec.id })
    }
    const software = await sniffSoftware(base, timeoutMs)
    return { kind: 'openai', software, models }
  }

  return null
}

/**
 * Best-effort software sniff for OpenAI-compatible endpoints.
 * Only hits endpoints that never trigger model loads.
 */
async function sniffSoftware(base: string, timeoutMs: number): Promise<string | undefined> {
  // LM Studio exposes a native model list endpoint.
  const lm = await fetchJson(`${base}/api/v0/models`, Math.min(timeoutMs, 1500))
  if (lm && lm.status === 200) return 'LM Studio'
  const health = await fetchJson(`${base}/health`, Math.min(timeoutMs, 1500))
  if (health && health.status === 200) {
    const obj = asRecord(health.json)
    // llama.cpp, oMLX and several other servers all answer {"status":"ok"} here —
    // stay honest rather than claiming a specific one.
    if (obj && typeof obj.status === 'string') return 'OpenAI-compatible (llama.cpp-style)'
  }
  return undefined
}
