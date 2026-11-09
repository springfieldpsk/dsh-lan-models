/**
 * Real generation e2e: scan → pick ComfyUI node → generate one image.
 * Run: node test/e2e-gen.mjs
 */

import * as fs from 'node:fs'
import { apply, Config } from '../dist/index.js'

const registered = []
apply(
  {
    tools: { register: (def) => registered.push(def) },
    get: () => undefined,
  },
  Config({}),
)
const byName = Object.fromEntries(registered.map((t) => [t.name, t]))
const exec = (name, args) => byName[name].execute(args, { signal: new AbortController().signal })

console.log('=== lan_scan ===')
const scan = await exec('lan_scan', { refresh: true })
for (const s of scan.services.filter((s) => s.status === 'up')) {
  console.log(`up: ${s.key} [${s.software ?? s.kind}] loopback=${s.loopback}`)
}
const comfy = scan.services.filter((s) => s.kind === 'comfyui' && s.status === 'up')
if (!comfy.length) {
  console.error('FAIL: no ComfyUI up')
  process.exit(1)
}

console.log('\n=== lan_model_status (comfy) ===')
const status = await exec('lan_model_status', { node: comfy[0].key })
console.log(`software=${status.service.software} queue=${JSON.stringify(status.service.meta.queue)}`)
console.log(`gpus=${status.service.meta.gpus.map((g) => `${g.name} free=${(g.vramFree / 1024 ** 3).toFixed(0)}G`).join('; ')}`)
for (const [k, list] of Object.entries(status.comfyModels)) {
  if (Array.isArray(list) && list.length) console.log(`${k}: ${list.slice(0, 6).join(', ')}${list.length > 6 ? ', …' : ''}`)
}

console.log('\n=== lan_generate_image (real) ===')
const gen = await exec('lan_generate_image', {
  prompt: 'a tiny robot cat sitting on a local network switch, glowing LED eyes, cozy home lab shelf at night, warm bokeh, detailed, film still',
  negative: 'lowres, watermark, text, deformed',
  width: 1328,
  height: 1328,
  steps: 20,
  workflow: 'qwen-image',
})
if (gen.error) {
  console.error(`gen error: ${gen.error}`)
  process.exit(1)
}
console.log(`node=${gen.node} workflow=${gen.workflow} promptId=${gen.promptId}`)
console.log(`notes: ${(gen.notes ?? []).join(' | ')}`)
for (const f of gen.outputs.files) {
  const ok = fs.existsSync(f.path) && fs.statSync(f.path).size > 1000
  console.log(`${ok ? 'OK' : 'BAD'} ${f.path} (${f.bytes} bytes)`)
  if (!ok) process.exit(1)
}
console.log('\nE2E-GEN OK')
