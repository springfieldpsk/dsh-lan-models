/**
 * dsh-lan-models — LAN local-model mesh for DeepSeek Harness.
 *
 * Discovers model services across the LAN (ComfyUI / oMLX / Ollama / LM Studio /
 * vLLM / llama.cpp), exposes status + model inventories, drives ComfyUI image &
 * video generation with built-in or user workflows, and routes chat to LAN LLMs.
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as ConfigType, type StaticHostConfig } from './config.js'
import { LanRegistry } from './discovery/registry.js'
import { registerTools } from './tools.js'
import { registerCommands } from './commands.js'
import { registerSkills } from './skills.js'
import { registerLanPanelRoutes } from './panel/routes.js'

export const name = 'dsh-lan-models'
export const inject = ['tools']
export { Config }

export function apply(ctx: Context, config: ConfigType): void {
  const staticHosts: StaticHostConfig[] = (config.staticHosts ?? [])
    .map((h) => ({ url: h.url, alias: h.alias || undefined }))
    .filter((h) => !!h.url)

  const registry = new LanRegistry({
    cidrs: config.extraCidrs,
    ports: config.ports,
    tcpTimeoutMs: config.tcpTimeoutMs,
    httpTimeoutMs: config.httpTimeoutMs,
    concurrency: config.concurrency,
    staticHosts,
    cacheTtlMs: config.cacheTtlSeconds * 1000,
    scanDeadlineMs: config.scanDeadlineSeconds * 1000,
  })

  registerTools(ctx.tools, config, registry)

  // commands / skills are optional seams: register when the profile provides them.
  const commands = (ctx as unknown as { get?: (name: string) => unknown }).get?.('commands') as never
  const skills = (ctx as unknown as { get?: (name: string) => unknown }).get?.('skills') as never
  registerCommands(commands, config, registry)
  registerSkills(skills, config)

  // The settings panel's data routes exist only where a web server does; the
  // headless profiles keep the tools and lose nothing else.
  const inject = (ctx as unknown as { inject?: (names: string[], run: (scope: any) => void) => void }).inject
  if (typeof inject === 'function') {
    inject.call(ctx, ['webServer'], (scope: any) => {
      try {
        const dispose = registerLanPanelRoutes(scope, registry, config)
        if (typeof scope.effect === 'function') scope.effect(() => dispose, 'lan-models: panel routes')
      } catch (error) {
        console.error(`[lan-models] panel routes skipped: ${error}`)
      }
    })
  }
}
