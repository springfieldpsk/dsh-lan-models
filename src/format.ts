/** Shared formatting helpers for tool render and the /lan command. */

import type { ServiceRecord } from './types.js'

function gb(bytes?: number): string {
  return typeof bytes === 'number' && bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)}G` : ''
}

export function formatServiceLine(r: ServiceRecord): string {
  const parts: string[] = []
  parts.push(r.alias ? `**${r.alias}** (${r.key})` : `**${r.key}**`)
  parts.push(r.status === 'up' ? '🟢' : '🔴')
  const kindLabel = r.software ?? (r.kind === 'unknown' ? 'unknown' : r.kind)
  parts.push(kindLabel)
  if (r.models.length) parts.push(`${r.models.length} model(s): ${r.models.slice(0, 5).map((m) => m.id).join(', ')}${r.models.length > 5 ? ', …' : ''}`)
  if (r.meta?.gpus?.length) {
    const gpu = r.meta.gpus[0]
    parts.push(`GPU: ${gpu.name ?? '?'}${gb(gpu.vramFree) ? ` (free ${gb(gpu.vramFree)}/${gb(gpu.vramTotal)})` : ''}`)
  }
  if (r.meta?.queue) parts.push(`queue: ${r.meta.queue.running} running / ${r.meta.queue.pending} pending`)
  if (r.status !== 'up' && r.error) parts.push(`— ${r.error}`)
  if (r.loopback) parts.push('_(loopback: 仅本机可用)_')
  return `- ${parts.join(' · ')}`
}

export function formatScan(records: ServiceRecord[]): string {
  if (!records.length) return 'No model services found on the LAN. Check ports config / start your services (ComfyUI :8188, oMLX/Ollama/vLLM …).'
  const up = records.filter((r) => r.status === 'up')
  const header = `Found ${up.length} up / ${records.length} tracked service(s):`
  return [header, ...records.map(formatServiceLine)].join('\n')
}
