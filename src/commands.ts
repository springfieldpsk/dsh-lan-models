/** `/lan` slash command: one-shot LAN dashboard without an agent round-trip. */

import type { Config } from './config.js'
import type { LanRegistry } from './discovery/registry.js'
import { formatScan } from './format.js'

interface CommandsService {
  register(def: {
    name: string
    description: string
    input?: { hint: string }
    handler: (invocation: { rawInput: string }) => Promise<{ kind: 'success'; text?: string } | { kind: 'error'; text: string }>
  }): () => void
}

export function registerCommands(commands: CommandsService | undefined, config: Config, registry: LanRegistry): void {
  if (!commands) return
  commands.register({
    name: 'lan',
    description: '扫描局域网模型服务并显示总览（输入 refresh 强制重扫）',
    input: { hint: 'refresh（可选）' },
    handler: async ({ rawInput }) => {
      const refresh = /refresh|重扫|强制/i.test(rawInput)
      try {
        const services = await registry.scan({ refresh })
        return { kind: 'success', text: formatScan(services) }
      } catch (err) {
        return { kind: 'error', text: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}
