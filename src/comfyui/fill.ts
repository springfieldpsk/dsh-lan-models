/**
 * Fill a ComfyUI API-format workflow from natural generation params.
 * Heuristics are driven by class_type and the sampler's positive/negative wiring,
 * so both built-in templates and user-exported workflows work without tagging.
 */

import type { WorkflowApi } from './client.js'

export interface GenParams {
  prompt?: string
  negative?: string
  width?: number
  height?: number
  steps?: number
  cfg?: number
  seed?: number
  batch?: number
  model?: string
  /** Video: frame count (maps to `length`-style inputs). */
  frames?: number
  /** Video: frame rate (maps to VHS_VideoCombine.frame_rate etc.). */
  fps?: number
  filenamePrefix?: string
}

export interface AvailableModels {
  checkpoints?: string[]
  diffusionModels?: string[]
  clip?: string[]
  vae?: string[]
}

export interface FillResult {
  workflow: WorkflowApi
  /** Human-readable notes about what was filled / could not be filled. */
  notes: string[]
  /** Fatal problems: a loader still has no usable model — do not submit. */
  errors: string[]
}

function isSampler(classType: string): boolean {
  return /sampler|scheduler/i.test(classType) && !/Loader/i.test(classType)
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 48)
}

/** Resolve the positive/negative text-encode node ids from the sampler wiring. */
function findTextNodes(wf: WorkflowApi): { sampler?: string; positive?: string; negative?: string } {
  let sampler: string | undefined
  for (const [id, node] of Object.entries(wf)) {
    if (isSampler(node.class_type)) {
      sampler = id
      break
    }
  }
  if (!sampler) return {}
  const inputs = wf[sampler].inputs
  const ref = (v: unknown): string | undefined => (Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined)
  const positive = ref(inputs.positive)
  const negative = ref(inputs.negative)
  return { sampler, positive, negative }
}

function pickModel(available: string[] | undefined, wanted: string | undefined, current: unknown, label: string): { name?: string; note?: string; error?: string } {
  const cur = typeof current === 'string' && current.length > 0 ? current : undefined
  if (wanted) {
    if (available?.length) {
      const exact = available.find((m) => m === wanted)
      if (exact) return { name: exact }
      const fuzzy = available.find((m) => m.toLowerCase().includes(wanted.toLowerCase()) || wanted.toLowerCase().includes(m.toLowerCase()))
      if (fuzzy) return { name: fuzzy, note: `${label} "${wanted}" fuzzy-matched to "${fuzzy}"` }
      return { error: `${label} "${wanted}" not found on this node; available: ${available.slice(0, 8).join(', ')}` }
    }
    return { name: wanted }
  }
  // No explicit model: keep a valid current value, else auto-pick the first available.
  if (cur && (!available?.length || available.includes(cur))) return {}
  if (available?.length) return { name: available[0], note: `${label} auto-picked "${available[0]}"` }
  if (cur) return {}
  return { error: `no ${label.toLowerCase()} available on this node (empty list)` }
}

export function applyParams(input: WorkflowApi, params: GenParams, available?: AvailableModels): FillResult {
  const wf = clone(input)
  const notes: string[] = []
  const errors: string[] = []
  const { sampler, positive, negative } = findTextNodes(wf)

  // --- text prompts ---
  if (params.prompt != null) {
    const target = positive ?? findNodeByTitle(wf, /prompt|positive/i)
    if (target && 'text' in wf[target].inputs) wf[target].inputs.text = params.prompt
    else notes.push(`could not find a text-encode node for the prompt (looked at sampler wiring / titles)`)
  }
  if (params.negative != null) {
    const target = negative ?? findNodeByTitle(wf, /negative/i)
    if (target && 'text' in wf[target].inputs) wf[target].inputs.text = params.negative
    else notes.push('no negative text-encode node found; negative prompt ignored')
  }

  // --- sampler numerics ---
  if (sampler) {
    const inputs = wf[sampler].inputs
    if (params.steps != null && 'steps' in inputs) inputs.steps = params.steps
    if (params.cfg != null) {
      if ('cfg' in inputs) inputs.cfg = params.cfg
      else if ('guidance' in inputs) inputs.guidance = params.cfg
    }
    if ('seed' in inputs) {
      const seed = params.seed != null ? params.seed : randomSeed()
      inputs.seed = seed
      if (params.seed == null) notes.push(`seed randomized to ${seed}`)
    }
    if ('noise_seed' in inputs) {
      const seed = params.seed != null ? params.seed : randomSeed()
      inputs.noise_seed = seed
    }
  } else {
    notes.push('no sampler node found; steps/cfg/seed not applied')
  }

  // --- latent size / frames ---
  for (const [id, node] of Object.entries(wf)) {
    if (!/EmptyLatent|Empty.*Latent/i.test(node.class_type)) continue
    const inputs = node.inputs
    if (params.width != null && 'width' in inputs) inputs.width = params.width
    if (params.height != null && 'height' in inputs) inputs.height = params.height
    if (params.batch != null && 'batch_size' in inputs) inputs.batch_size = params.batch
    if (params.frames != null) {
      if ('length' in inputs) inputs.length = params.frames
      else if ('num_frames' in inputs) inputs.num_frames = params.frames
      else if ('frames' in inputs) inputs.frames = params.frames
    }
    void id
  }

  // --- fps on video combine nodes ---
  if (params.fps != null) {
    for (const node of Object.values(wf)) {
      if (/VideoCombine|SaveAnimated|SaveVideo/i.test(node.class_type) && 'frame_rate' in node.inputs) {
        node.inputs.frame_rate = params.fps
      }
    }
  }

  // --- model loaders ---
  for (const node of Object.values(wf)) {
    if (node.class_type === 'CheckpointLoaderSimple' && 'ckpt_name' in node.inputs) {
      const { name, note, error } = pickModel(available?.checkpoints, params.model, node.inputs.ckpt_name, 'checkpoint')
      if (name) node.inputs.ckpt_name = name
      if (note) notes.push(note)
      if (error) errors.push(error)
    } else if (/UNETLoader|UnetLoaderGGUF|Load Diffusion Model/i.test(node.class_type) && 'unet_name' in node.inputs) {
      const { name, note, error } = pickModel(available?.diffusionModels, params.model, node.inputs.unet_name, 'diffusion model')
      if (name) node.inputs.unet_name = name
      if (note) notes.push(note)
      if (error) errors.push(error)
    } else if (node.class_type === 'CLIPLoader' && 'clip_name' in node.inputs) {
      const { name, note, error } = pickModel(available?.clip, undefined, node.inputs.clip_name, 'CLIP model')
      if (name) node.inputs.clip_name = name
      if (note) notes.push(note)
      if (error) errors.push(error)
    } else if (node.class_type === 'VAELoader' && 'vae_name' in node.inputs) {
      const { name, note, error } = pickModel(available?.vae, undefined, node.inputs.vae_name, 'VAE model')
      if (name) node.inputs.vae_name = name
      if (note) notes.push(note)
      if (error) errors.push(error)
    }
  }

  // --- filename prefix ---
  if (params.filenamePrefix != null) {
    for (const node of Object.values(wf)) {
      if (/^Save|VideoCombine|SaveAnimated/i.test(node.class_type) && 'filename_prefix' in node.inputs) {
        node.inputs.filename_prefix = params.filenamePrefix
      }
    }
  }

  return { workflow: wf, notes, errors }
}

function findNodeByTitle(wf: WorkflowApi, pattern: RegExp): string | undefined {
  for (const [id, node] of Object.entries(wf)) {
    if (node._meta?.title && pattern.test(node._meta.title) && 'text' in node.inputs) return id
  }
  return undefined
}
