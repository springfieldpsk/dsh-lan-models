/** Shared types across discovery / llm / comfyui layers. */

export type ServiceKind = 'openai' | 'ollama' | 'comfyui' | 'unknown'

export interface ModelRef {
  /** Model id as accepted by the service API (e.g. chat `model`, ComfyUI checkpoint name). */
  id: string
  /** Optional detail, e.g. size / quantization. */
  detail?: string
}

export interface GpuInfo {
  name?: string
  vramTotal?: number
  vramFree?: number
}

export interface ServiceMeta {
  gpus?: GpuInfo[]
  queue?: { running: number; pending: number }
  versions?: Record<string, string>
  [k: string]: unknown
}

export interface ServiceRecord {
  /** Base URL, e.g. http://192.168.5.115:8000 — unique key of the record. */
  key: string
  host: string
  port: number
  kind: ServiceKind
  /** Human alias from staticHosts config, if any. */
  alias?: string
  /** Best-effort software identification, e.g. "ComfyUI 0.37.0", "Ollama", "oMLX". */
  software?: string
  /** True when the URL points at loopback (only usable from this machine). */
  loopback: boolean
  status: 'up' | 'down' | 'unknown'
  models: ModelRef[]
  meta?: ServiceMeta
  error?: string
  source: 'scan' | 'static'
  /** ms timestamp of last successful probe. */
  probedAt?: number
}
