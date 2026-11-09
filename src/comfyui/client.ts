/** ComfyUI HTTP API client (workflow submit / poll / fetch outputs). */

/** ComfyUI API-format workflow: node id -> { class_type, inputs, _meta? }. */
export type WorkflowApi = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>

export interface ComfySubmitResult {
  promptId: string
  number: number
}

export interface ComfyHistoryEntry {
  status?: { completed?: boolean; status_str?: string; messages?: unknown[] }
  outputs?: Record<string, { images?: ComfyFileRef[]; gifs?: ComfyFileRef[]; videos?: ComfyFileRef[] }>
}

export interface ComfyFileRef {
  filename: string
  subfolder?: string
  type?: string
}

export interface ComfyModelError extends Error {
  nodeErrors: Record<string, { errors: { type: string; message: string; details?: string }[] }>
}

export class ComfyClient {
  constructor(
    private baseUrl: string,
    private timeoutMs = 10_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  private async getJson<T>(path: string, timeoutMs = this.timeoutMs): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
    return (await res.json()) as T
  }

  systemStats(): Promise<{
    system?: { os?: string; ram_total?: number; ram_free?: number }
    devices?: { name?: string; type?: string; vram_total?: number; vram_free?: number }[]
    comfyui_version?: string
  }> {
    return this.getJson('/system_stats')
  }

  queue(): Promise<{ running: number; pending: number }> {
    return this.getJson<{ queue_running?: unknown[]; queue_pending?: unknown[] }>('/queue').then((q) => ({
      running: q.queue_running?.length ?? 0,
      pending: q.queue_pending?.length ?? 0,
    }))
  }

  objectInfo(): Promise<Record<string, { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } }>> {
    return this.getJson('/object_info', 30_000)
  }

  /** Model lists (checkpoints / unets / vae / clip / loras) from /object_info. */
  async listModels(): Promise<Record<string, string[]>> {
    const info = await this.objectInfo()
    const pick = (cls: string, field: string): string[] => {
      const entry = info[cls]?.input?.required?.[field] ?? info[cls]?.input?.optional?.[field]
      // Combo inputs look like [["a.safetensors","b.safetensors"], {tooltip}]
      if (Array.isArray(entry) && Array.isArray(entry[0])) return entry[0].filter((x): x is string => typeof x === 'string')
      return []
    }
    return {
      checkpoints: pick('CheckpointLoaderSimple', 'ckpt_name'),
      diffusionModels: [...pick('UNETLoader', 'unet_name'), ...pick('UnetLoaderGGUF', 'unet_name')],
      vae: pick('VAELoader', 'vae_name'),
      clip: pick('CLIPLoader', 'clip_name'),
      loras: pick('LoraLoader', 'lora_name'),
    }
  }

  /** Submit an API-format workflow. Throws ComfyModelError with per-node details on validation failure. */
  async submit(workflow: WorkflowApi, clientId: string): Promise<ComfySubmitResult> {
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    const json = (await res.json().catch(() => ({}))) as {
      prompt_id?: string
      number?: number
      error?: { message?: string; type?: string }
      node_errors?: Record<string, { errors: { type: string; message: string; details?: string }[] }>
    }
    if (!res.ok || json.error || json.node_errors) {
      const nodeErrors = json.node_errors ?? {}
      const err = new Error(
        `ComfyUI rejected workflow: ${json.error?.message ?? res.status}${
          Object.keys(nodeErrors).length ? ` (nodes: ${Object.keys(nodeErrors).join(', ')})` : ''
        }`,
      ) as ComfyModelError
      err.nodeErrors = nodeErrors
      throw err
    }
    return { promptId: json.prompt_id!, number: json.number ?? -1 }
  }

  async history(promptId: string): Promise<ComfyHistoryEntry | null> {
    const json = await this.getJson<Record<string, ComfyHistoryEntry>>(`/history/${promptId}`)
    return json[promptId] ?? null
  }

  /** Poll /history until the prompt finishes; resolves with its entry, rejects on timeout/abort. */
  async waitPrompt(
    promptId: string,
    timeoutMs: number,
    opts: { pollMs?: number; onTick?: (status: { running: number; pending: number }) => void; signal?: AbortSignal } = {},
  ): Promise<ComfyHistoryEntry> {
    const { pollMs = 1500, onTick, signal } = opts
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error(`prompt ${promptId} aborted`)
      const entry = await this.history(promptId).catch(() => null)
      if (entry) {
        const done = entry.status?.completed === true || Object.keys(entry.outputs ?? {}).length > 0
        if (done) return entry
        if (entry.status?.status_str && entry.status.status_str !== 'executing') {
          return entry // failed / cancelled — caller inspects status_str
        }
      } else if (onTick) {
        onTick(await this.queue().catch(() => ({ running: 0, pending: 0 })))
      }
      await new Promise((r) => setTimeout(r, pollMs))
    }
    throw new Error(
      `ComfyUI prompt ${promptId} did not finish within ${Math.round(timeoutMs / 1000)}s (the job stays in the remote queue; check lan_model_status)`,
    )
  }

  /** Collect output file references (images/gifs/videos) from a history entry. */
  collectFiles(entry: ComfyHistoryEntry): ComfyFileRef[] {
    const files: ComfyFileRef[] = []
    for (const out of Object.values(entry.outputs ?? {})) {
      for (const key of ['images', 'gifs', 'videos'] as const) {
        for (const f of out[key] ?? []) files.push(f)
      }
    }
    return files
  }

  async download(ref: ComfyFileRef, timeoutMs = 120_000): Promise<{ buffer: ArrayBuffer; contentType: string }> {
    const params = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder ?? '', type: ref.type ?? 'output' })
    const res = await fetch(`${this.baseUrl}/view?${params}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`download ${ref.filename} -> ${res.status}`)
    return { buffer: await res.arrayBuffer(), contentType: res.headers.get('content-type') ?? 'application/octet-stream' }
  }

  /** Interrupt the running prompt (best effort). */
  async interrupt(): Promise<void> {
    await fetch(`${this.baseUrl}/interrupt`, { method: 'POST', signal: AbortSignal.timeout(this.timeoutMs) })
  }
}
