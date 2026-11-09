/**
 * Loopback JSON routes behind the settings panel. The browser half is a
 * hand-written client bundle that talks to these routes with plain fetch, so
 * no typert remote schema has to be published for a settings page.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.js'
import type { LanRegistry } from '../discovery/registry.js'
import { listMounted, mountProvider, providerIdFor, unmountProvider } from './mount.js'

const MAX_BODY = 256 * 1024

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost' || hostname === '[::1]'
}

/** Same-origin loopback only: the host binds 127.0.0.1, and a cross-site page must not drive it. */
function isTrusted(req: IncomingMessage): boolean {
  const host = req.headers?.host
  if (typeof host !== 'string' || host === '') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHost(hostUrl.hostname)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  return JSON.parse(text)
}

export function registerLanPanelRoutes(ctx: Context, registry: LanRegistry, _config: Config): () => void {
  const holder = ctx as unknown as { webServer?: { register(route: unknown): () => void } }
  const server = holder.webServer
  if (!server || typeof server.register !== 'function') throw new Error('webServer 不可用')

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  return server.register({
    name: 'lan-models-panel',
    kind: 'prefix',
    path: '/lan-models',
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isTrusted(req)) {
        send(res, 403, { error: '只接受同源回环请求' })
        return
      }
      const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/lan-models'

      try {
        if (path === '/lan-models/state' && req.method === 'GET') {
          const services = await registry.scan({})
          const meta = registry.scanMeta
          const mounted = listMounted(ctx)
          send(res, 200, {
            services: services.map((r) => ({
              key: r.key,
              kind: r.kind,
              software: r.software,
              status: r.status,
              alias: r.alias,
              loopback: r.loopback,
              models: r.models.map((m) => m.id),
            })),
            mounted,
            cidrs: meta.cidrs,
            truncated: meta.truncated,
            tookMs: meta.tookMs,
          })
          return
        }

        if (path === '/lan-models/mount' && req.method === 'POST') {
          const body = await readJson(req)
          const key = typeof body?.key === 'string' ? body.key : ''
          if (key === '') throw new Error('缺少参数 key（服务地址，如 http://192.168.5.115:8000）')
          const services = await registry.scan({})
          const record = services.find((r) => r.key === key)
          if (!record) throw new Error(`未找到服务 ${key}，先刷新扫描`)
          if (record.kind !== 'openai') {
            throw new Error(`${key} 不是 OpenAI 兼容服务（识别为 ${record.kind}），不能装载成对话模型`)
          }
          const models = Array.isArray(body?.models) && body.models.length > 0
            ? body.models.map((m: unknown) => ({ id: String(m) }))
            : record.models.map((m) => ({ id: m.id, name: m.id }))
          const displayName =
            typeof body?.displayName === 'string' && body.displayName.trim() !== ''
              ? body.displayName
              : `${record.software ?? 'LAN'} · ${record.host}:${record.port}`
          const mounted = await mountProvider(ctx, {
            providerId: typeof body?.providerId === 'string' && body.providerId !== '' ? body.providerId : providerIdFor(record.key),
            displayName,
            baseURL: record.key,
            models,
          })
          send(res, 200, { mounted, providers: listMounted(ctx) })
          return
        }

        if (path === '/lan-models/unmount' && req.method === 'POST') {
          const body = await readJson(req)
          const providerId = typeof body?.providerId === 'string' ? body.providerId : ''
          if (providerId === '') throw new Error('缺少参数 providerId')
          await unmountProvider(ctx, providerId)
          send(res, 200, { providers: listMounted(ctx) })
          return
        }

        send(res, 404, { error: `unknown route: ${req.method} ${path}` })
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}
