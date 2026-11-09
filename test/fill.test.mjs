import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyParams } from '../dist/comfyui/fill.js'
import { BUILTIN_WORKFLOWS, isValidWorkflowApi, resolveWorkflow, loadCustomWorkflows } from '../dist/comfyui/workflows.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

test('built-in workflows are valid API format', () => {
  for (const [name, wf] of Object.entries(BUILTIN_WORKFLOWS)) {
    assert.ok(isValidWorkflowApi(wf), `${name} should be valid`)
  }
})

test('applyParams fills prompts via sampler wiring', () => {
  const { workflow, notes } = applyParams(BUILTIN_WORKFLOWS.txt2img, {
    prompt: 'a cat',
    negative: 'ugly',
    seed: 42,
    steps: 30,
    cfg: 7,
    width: 768,
    height: 512,
  }, { checkpoints: ['mock_sdxl.safetensors'] })
  assert.equal(workflow['2'].inputs.text, 'a cat') // positive per KSampler wiring
  assert.equal(workflow['3'].inputs.text, 'ugly') // negative
  assert.equal(workflow['5'].inputs.seed, 42)
  assert.equal(workflow['5'].inputs.steps, 30)
  assert.equal(workflow['5'].inputs.cfg, 7)
  assert.equal(workflow['4'].inputs.width, 768)
  assert.equal(workflow['4'].inputs.height, 512)
  assert.equal(workflow['1'].inputs.ckpt_name, 'mock_sdxl.safetensors')
  assert.equal(workflow['1'].inputs.ckpt_name, 'mock_sdxl.safetensors')
  assert.ok(!notes.some((n) => /not found/i.test(n)))
})

test('applyParams fuzzy-matches model and randomizes seed with a note', () => {
  const { workflow, notes } = applyParams(BUILTIN_WORKFLOWS.txt2img, { prompt: 'x', model: 'sdxl' }, { checkpoints: ['mock_sdxl.safetensors'] })
  assert.equal(workflow['1'].inputs.ckpt_name, 'mock_sdxl.safetensors')
  assert.ok(notes.some((n) => /fuzzy-matched/.test(n)))
  assert.ok(notes.some((n) => /seed randomized/.test(n)))
})

test('applyParams on unet workflow fills unet_name + filename_prefix', () => {
  const { workflow } = applyParams(BUILTIN_WORKFLOWS['txt2img-unet'], {
    prompt: 'p',
    model: 'qwen',
    filenamePrefix: 'test_run',
  }, { diffusionModels: ['qwen_image_bf16.safetensors'] })
  assert.equal(workflow['1'].inputs.unet_name, 'qwen_image_bf16.safetensors')
  assert.equal(workflow['9'].inputs.filename_prefix, 'test_run')
})

test('applyParams auto-picks clip and vae, and reports fatal empty loaders', () => {
  // clip/vae auto-pick on the unet template
  const filled = applyParams(BUILTIN_WORKFLOWS['txt2img-unet'], { prompt: 'p' }, {
    diffusionModels: ['qwen_image_2.1.safetensors'],
    clip: ['qwen3vl_4b_fp8.safetensors'],
    vae: ['qwen_image_vae.safetensors'],
  })
  assert.equal(filled.workflow['2'].inputs.clip_name, 'qwen3vl_4b_fp8.safetensors')
  assert.equal(filled.workflow['3'].inputs.vae_name, 'qwen_image_vae.safetensors')
  assert.equal(filled.errors.length, 0)
  assert.ok(filled.notes.some((n) => /CLIP model auto-picked/.test(n)))

  // checkpoint template with empty ckpt_name and no checkpoints -> fatal error, not a submit
  const broken = applyParams(BUILTIN_WORKFLOWS.txt2img, { prompt: 'p' }, { checkpoints: [], diffusionModels: ['x.safetensors'] })
  assert.ok(broken.errors.length >= 1)
  assert.match(broken.errors.join('; '), /no checkpoint available/)
})

test('custom workflows dir overrides builtin by name', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-'))
  const custom = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'custom.safetensors' } },
    '2': { class_type: 'SaveImage', inputs: { filename_prefix: 'custom', images: ['9', 0] } },
  }
  await fs.writeFile(path.join(dir, 'txt2img.json'), JSON.stringify(custom))
  const { workflows, errors } = await loadCustomWorkflows(dir)
  assert.equal(errors.length, 0)
  assert.equal(workflows.txt2img['1'].inputs.ckpt_name, 'custom.safetensors')

  const resolved = await resolveWorkflow('txt2img', dir)
  assert.equal(resolved.source, 'custom')
  assert.equal(resolved.workflow['1'].inputs.ckpt_name, 'custom.safetensors')

  const missing = await resolveWorkflow('nope', dir)
  assert.ok('available' in missing)
  await fs.rm(dir, { recursive: true, force: true })
})
