/**
 * Real-environment e2e harness: loads the plugin exactly like dsh would
 * (apply(ctx, config) against a capturing fake context) and exercises the
 * tools against whatever is actually running on this machine / LAN.
 * Run: node test/e2e-real.mjs [--skip-chat]
 */

import { apply, Config } from '../dist/index.js'

const registered = []
const ctx = {
  tools: { register: (def) => registered.push(def) },
  get: () => undefined,
}
const config = Config({})
apply(ctx, config)

const byName = Object.fromEntries(registered.map((t) => [t.name, t]))
console.log(`registered tools: ${registered.map((t) => t.name).join(', ')}`)
if (registered.length !== 5) {
  console.error('FAIL: expected 5 tools')
  process.exit(1)
}
const exec = (name, args) => byName[name].execute(args, { signal: new AbortController().signal })

// 1. lan_scan against the real network
console.log('\n=== lan_scan (refresh) ===')
const scan = await exec('lan_scan', { refresh: true })
const up = scan.services.filter((s) => s.status === 'up')
console.log(`up services: ${up.map((s) => `${s.key} [${s.software ?? s.kind}] models=${s.models.length} gpus=${s.meta?.gpus?.length ?? 0} loopback=${s.loopback}`).join(' | ')}`)
if (!up.some((s) => s.key === 'http://127.0.0.1:8000')) {
  console.error('FAIL: expected oMLX at 127.0.0.1:8000 to be found')
  process.exit(1)
}

// 2. lan_model_status detail on the LLM endpoint
console.log('\n=== lan_model_status (127.0.0.1:8000) ===')
const status = await exec('lan_model_status', { node: '127.0.0.1:8000' })
console.log(`kind=${status.service?.kind} software=${status.service?.software} models=${status.service?.models.map((m) => m.id).join(', ')}`)

// 3. lan_chat round-trip to the real oMLX (small budget)
if (!process.argv.includes('--skip-chat')) {
  console.log('\n=== lan_chat (real oMLX round-trip) ===')
  const chat = await exec('lan_chat', { prompt: '用一句话回答：1+1等于几？', maxTokens: 2048 })
  if (chat.error) {
    console.error(`chat error: ${chat.error}`)
    process.exit(1)
  }
  console.log(`model=${chat.model} node=${chat.node}`)
  console.log(`reasoning: ${chat.reasoning ? chat.reasoning.slice(0, 120) + '…' : '(none)'}`)
  console.log(`content: ${chat.content}`)
}

console.log('\nE2E-REAL OK')
