/**
 * "装载" half of the panel: turn one discovered OpenAI-compatible endpoint into
 * an `llm-pi-ai` provider route, so the model shows up in dsh's model selector
 * and can be switched per session.
 *
 * We deliberately reuse the pi-ai adapter instead of writing our own
 * `LlmAdapter`: the route config below is the same shape the official Models
 * page writes, and configEditor.edit() persists it and lets the Loader
 * reconcile, so no new wire-protocol code lives in this plugin.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Route keys this plugin owns. Only these are unmountable from the panel. */
const ROUTE_PREFIX = 'lan-'
const PIAI_NAME = 'dsh-llm-pi-ai'

export interface LanModelSpec {
  id: string
  name?: string
  contextWindow?: number
}

export interface MountSpec {
  providerId: string
  displayName: string
  baseURL: string
  models: LanModelSpec[]
  /** Bearer token for endpoints that require one (oMLX refuses a non-loopback bind without a key). */
  apiKey?: string
}

export interface MountedProvider {
  providerId: string
  displayName: string
  baseURL?: string
  modelCount: number
  models: string[]
}

interface EntryLike {
  id?: string
  options?: { name?: string; config?: Record<string, unknown> }
}

interface ConfigEditorLike {
  entries(): EntryLike[]
  configuration(): Array<{ entry: EntryLike; inherited: Record<string, unknown>; override: Record<string, unknown> }>
  edit(
    entry: EntryLike,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

function editorOf(ctx: Context): ConfigEditorLike {
  const holder = ctx as unknown as { configEditor?: ConfigEditorLike; get?: (name: string) => unknown }
  // `ctx.configEditor` is a guarded getter: touching it without an `inject`
  // declaration throws. `get()` is the unguarded lookup, so it goes first.
  let editor: ConfigEditorLike | undefined
  try {
    editor = holder.get?.('configEditor') as ConfigEditorLike | undefined
  } catch {
    editor = undefined
  }
  if (!editor) {
    try {
      editor = holder.configEditor
    } catch {
      editor = undefined
    }
  }
  if (!editor || typeof editor.edit !== 'function') {
    throw new Error('configEditor 不可用：只有带配置编辑器的 profile 才能装载模型')
  }
  return editor
}

function isPiAi(entry: EntryLike): boolean {
  const name = entry.options?.name ?? ''
  return name.includes(PIAI_NAME) || (entry.id ?? '').includes('llm-pi-ai')
}

function findPiAiEntry(editor: ConfigEditorLike): EntryLike {
  const entries = editor.entries()
  const hit = entries.find(isPiAi)
  if (!hit) {
    const known = entries
      .map((e) => e.options?.name ?? e.id)
      .filter(Boolean)
      .join(', ')
    throw new Error(`未找到 llm-pi-ai 配置项（当前条目：${known || '空'}）`)
  }
  return hit
}

function providersOf(row: { inherited: Record<string, unknown>; override: Record<string, unknown> }): Record<string, any> {
  const merged = { ...(row.inherited ?? {}), ...(row.override ?? {}) } as Record<string, any>
  const providers = merged.providers
  return providers && typeof providers === 'object' ? (providers as Record<string, any>) : {}
}

/** Providers this plugin has loaded, read from the live pi-ai configuration. */
export function listMounted(ctx: Context): MountedProvider[] {
  const editor = editorOf(ctx)
  const rows = editor.configuration().filter((row) => isPiAi(row.entry))
  const providers = rows.length > 0 ? providersOf(rows[0]) : {}
  return Object.entries(providers)
    .filter(([id]) => id.startsWith(ROUTE_PREFIX))
    .map(([providerId, value]) => {
      const profile = (value ?? {}) as Record<string, any>
      const models = Array.isArray(profile.models) ? profile.models : []
      return {
        providerId,
        displayName: typeof profile.displayName === 'string' ? profile.displayName : providerId,
        baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : undefined,
        modelCount: models.length,
        models: models.map((m: any) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean),
      }
    })
}

/** Stable route key for one discovered endpoint, e.g. `lan-192-168-5-115-8000`. */
export function providerIdFor(key: string): string {
  const u = new URL(key)
  const host = u.hostname.replace(/\./g, '-').replace(/[^a-z0-9-]/gi, '')
  const port = u.port || (u.protocol === 'https:' ? '443' : '80')
  return `${ROUTE_PREFIX}${host}-${port}`
}

/** Accept `http://host:port`, `http://host:port/`, `http://host:port/v1`; add `/v1` when bare. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error(`无效的服务地址：${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`只支持 http/https 服务：${raw}`)
  }
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path === '' ? '/v1' : path
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

export async function mountProvider(ctx: Context, spec: MountSpec): Promise<MountedProvider> {
  const providerId = spec.providerId.trim()
  if (!/^lan-[a-z0-9-]{1,48}$/.test(providerId)) {
    throw new Error(`非法 provider id：${providerId}（只允许 lan-[a-z0-9-]）`)
  }
  const baseURL = normalizeBaseUrl(spec.baseURL)
  const models = spec.models
    .filter((m) => typeof m?.id === 'string' && m.id.trim() !== '')
    .map((m) => ({
      id: m.id.trim(),
      ...(m.name ? { name: m.name } : {}),
      ...(m.contextWindow && m.contextWindow > 0 ? { contextWindow: m.contextWindow } : {}),
    }))
  if (models.length === 0) throw new Error('该服务没有可装载的模型（先用 lan_model_status 确认 /v1/models）')

  const editor = editorOf(ctx)
  const entry = findPiAiEntry(editor)
  await editor.edit(entry, (current) => {
    const providers = { ...((current.providers as Record<string, any>) ?? {}) }
    providers[providerId] = {
      displayName: spec.displayName.trim() || providerId,
      api: 'openai-completions',
      baseURL,
      models,
      ...(spec.apiKey && spec.apiKey.trim() !== ''
        ? { headers: { Authorization: `Bearer ${spec.apiKey.trim()}` } }
        : {}),
      defaultContextWindow: 131072,
      defaultMaxTokens: 8192,
    }
    return { ...current, providers }
  })
  return {
    providerId,
    displayName: spec.displayName.trim() || providerId,
    baseURL,
    modelCount: models.length,
    models: models.map((m) => m.id),
  }
}

export async function unmountProvider(ctx: Context, providerId: string): Promise<void> {
  if (!providerId.startsWith(ROUTE_PREFIX)) {
    throw new Error(`只能卸载本插件装载的路由（${ROUTE_PREFIX}*）：${providerId}`)
  }
  const editor = editorOf(ctx)
  const entry = findPiAiEntry(editor)
  await editor.edit(entry, (current) => {
    const providers = { ...((current.providers as Record<string, any>) ?? {}) }
    if (!(providerId in providers)) return current
    delete providers[providerId]
    return { ...current, providers }
  })
}
