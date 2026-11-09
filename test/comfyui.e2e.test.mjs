import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { startMockComfyUI } from './mock-comfyui.mjs'
import { ComfyClient } from '../dist/comfyui/client.js'
import { saveOutputs } from '../dist/comfyui/assets.js'
import { probeService } from '../dist/discovery/probes.js'
import { LanRegistry } from '../dist/discovery/registry.js'

test('probeService fingerprints the mock as ComfyUI with gpu/queue meta', async () => {
  const mock = await startMockComfyUI()
  try {
    const url = new URL(mock.url)
    const hit = await probeService('127.0.0.1', url.port, 2000)
    assert.ok(hit, 'probe should recognize the service')
    assert.equal(hit.kind, 'comfyui')
    assert.match(hit.software, /ComfyUI 0\.37\.0/)
    assert.equal(hit.meta.gpus[0].name, 'Apple M5 Ultra')
    assert.deepEqual(hit.meta.queue, { running: 1, pending: 2 })
  } finally {
    await mock.close()
  }
})

test('full pipeline: listModels → submit → wait → saveOutputs', async () => {
  const mock = await startMockComfyUI()
  try {
    const client = new ComfyClient(mock.url, 2000)
    const models = await client.listModels()
    assert.ok(models.checkpoints.includes('mock_sdxl.safetensors'))

    const wf = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'mock_sdxl.safetensors' } },
      '2': { class_type: 'SaveImage', inputs: { filename_prefix: 't', images: ['1', 0] } },
    }
    const { promptId } = await client.submit(wf, 'test-client')
    const entry = await client.waitPrompt(promptId, 10_000, { pollMs: 100 })
    assert.equal(entry.status.status_str, 'success')

    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'out-'))
    const saved = await saveOutputs(client, entry, outDir, 'e2e')
    assert.equal(saved.files.length, 1)
    const stat = await fs.stat(saved.files[0].path)
    assert.ok(stat.size > 50, 'png bytes should be written')
    await fs.rm(outDir, { recursive: true, force: true })
    assert.equal(mock.submissions.length, 1)
  } finally {
    await mock.close()
  }
})

test('registry merges staticHosts and picks comfy/openai nodes', async () => {
  const mock = await startMockComfyUI()
  try {
    const reg = new LanRegistry({
      cidrsOnly: [], // no scan targets: static hosts only
      staticHosts: [{ url: mock.url, alias: 'mock-comfy' }],
      cacheTtlMs: 0,
    })
    const records = await reg.scan({})
    assert.equal(records.length, 1)
    assert.equal(records[0].kind, 'comfyui')
    assert.equal(records[0].alias, 'mock-comfy')
    assert.equal(records[0].status, 'up')

    const picked = reg.pickComfyUI(records, 'mock-comfy')
    assert.equal(picked?.key, mock.url)
    assert.equal(reg.pickOpenAI(records, undefined, undefined), undefined, 'no openai service present')

    const dead = new LanRegistry({ cidrsOnly: [], staticHosts: [{ url: 'http://127.0.0.1:1', alias: 'dead' }] })
    const deadRecords = await dead.scan({})
    assert.equal(deadRecords[0].status, 'down')
  } finally {
    await mock.close()
  }
})
