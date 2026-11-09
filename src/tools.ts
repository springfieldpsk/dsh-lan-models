/**
 * The five agent-facing tools:
 *   lan_scan / lan_model_status / lan_generate_image / lan_generate_video / lan_chat
 */

import * as crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.js'
import { resolveOutputsDir, resolveWorkflowsDir } from './config.js'
import type { LanRegistry } from './discovery/registry.js'
import { formatScan, formatServiceLine } from './format.js'
import { chatCompletion, type ChatMessage } from './llm/openai.js'
import { ComfyClient } from './comfyui/client.js'
import { applyParams } from './comfyui/fill.js'
import { resolveWorkflow } from './comfyui/workflows.js'
import { saveOutputs } from './comfyui/assets.js'

interface ExecCtx {
  signal: AbortSignal
}

/** Normalize a tool result into plain lossless JSON (drops undefined, breaks interface types). */
const json = (v: unknown): any => JSON.parse(JSON.stringify(v))

function noComfyHint(records: { kind: string }[]): string {
  const anyComfy = records.some((r) => r.kind === 'comfyui')
  return anyComfy
    ? 'A ComfyUI node was seen but is not up right now — start it on that machine (e.g. run_comfyui scripts), then retry.'
    : 'No ComfyUI node is known. Start ComfyUI with --listen 0.0.0.0 --port 8188 on a LAN machine, or add it to staticHosts.'
}

function genParams(extra: Record<string, unknown>) {
  return {
    prompt: { type: 'string' as const, required: true as const, description: '正向提示词（生视频时描述主体、运动与镜头）' },
    negative: { type: 'string' as const, description: '负向提示词' },
    width: { type: 'integer' as const, description: '宽度（px）' },
    height: { type: 'integer' as const, description: '高度（px）' },
    steps: { type: 'integer' as const, description: '采样步数' },
    cfg: { type: 'number' as const, description: 'CFG/guidance 强度' },
    seed: { type: 'integer' as const, description: '随机种子；不填则随机' },
    model: { type: 'string' as const, description: '模型名（checkpoint / diffusion model），支持模糊匹配；不填自动选择' },
    node: { type: 'string' as const, description: 'ComfyUI 节点：alias、URL 片段或 IP；不填自动选择（优先局域网机器）' },
    workflow: { type: 'string' as const, description: '工作流名（自定义目录里同名覆盖内置）；生图默认 txt2img，生视频默认 txt2video' },
    ...extra,
  }
}

const filenamePrefixParam = { type: 'string' as const, description: '输出文件名前缀' }

export interface ToolRegistryLike {
  register(def: unknown): () => void
}

export function registerTools(tools: ToolRegistryLike, config: Config, registry: LanRegistry): void {
  const workflowsDir = resolveWorkflowsDir(config)
  const outputsDir = resolveOutputsDir(config)

  tools.register(
    defineTool({
      name: 'lan_scan',
      description:
        '扫描局域网，发现已部署的本地模型服务（ComfyUI / oMLX / Ollama / LM Studio / vLLM 等 OpenAI 兼容服务），返回地址、软件、模型清单、GPU 显存与队列状态。多机联动前先用它看清拓扑。',
      parameters: {
        refresh: { type: 'boolean', description: 'true 时忽略缓存强制重扫（默认缓存 60s）' },
        cidr: { type: 'string', description: '额外扫描的网段，如 "192.168.5.0/24"' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => {
          const v = value as { services: unknown[] }
          return [{ type: 'text', text: `${formatScan(v.services as never)}\n\n(raw JSON in tool result)` }]
        },
      },
      isConcurrencySafe: () => true,
      timeoutMs: 180_000,
      execute: async (args: { refresh?: boolean; cidr?: string }, exec: ExecCtx) => {
        const started = Date.now()
        const services = await registry.scan({ refresh: args.refresh === true, cidr: args.cidr })
        void exec
        return json({ services, tookMs: Date.now() - started })
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'lan_model_status',
      description:
        '查询单个模型服务的详细状态：模型清单、GPU/显存、队列；对 ComfyUI 额外返回可用的 checkpoint / diffusion model / VAE / LoRA 完整列表（生成前用它选模型）。',
      parameters: {
        node: { type: 'string', required: true, description: '服务地址（URL 片段、alias 或 IP，如 "192.168.5.115:8188" 或 "mac-llm"）' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => {
          const v = value as { service?: unknown }
          const lines = v.service ? [formatServiceLine(v.service as never)] : ['service not found']
          const comfy = v as { comfyModels?: Record<string, string[]> }
          if (comfy.comfyModels) {
            for (const [k, list] of Object.entries(comfy.comfyModels)) {
              lines.push(`- ${k}: ${list.length ? list.slice(0, 12).join(', ') + (list.length > 12 ? ', …' : '') : '(none)'}`)
            }
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      isConcurrencySafe: () => true,
      timeoutMs: 60_000,
      execute: async (args: { node: string }) => {
        const services = await registry.scan({})
        const key = args.node.toLowerCase()
        const hit =
          services.find((r) => r.alias?.toLowerCase() === key) ??
          services.find((r) => r.key.toLowerCase().includes(key) || r.host === key || `${r.host}:${r.port}` === key)
        if (!hit) return json({ error: `no tracked service matches "${args.node}" — run lan_scan first`, known: services.map((r) => r.key) })
        const service = await registry.statusOf(hit.key)
        if (service.kind !== 'comfyui' || service.status !== 'up') return json({ service })
        const comfyModels = await new ComfyClient(service.key, config.httpTimeoutMs).listModels().catch((err: Error) => ({ error: err.message }))
        return json({ service, comfyModels })
      },
    }),
  )

  async function runGeneration(
    kind: 'image' | 'video',
    args: {
      prompt: string
      negative?: string
      width?: number
      height?: number
      steps?: number
      cfg?: number
      seed?: number
      model?: string
      node?: string
      workflow?: string
      frames?: number
      fps?: number
      batch?: number
      filenamePrefix?: string
    },
    exec: ExecCtx,
  ): Promise<any> {
    const services = await registry.scan({})
    const target = registry.pickComfyUI(services, args.node)
    if (!target || target.status !== 'up') return json({ error: noComfyHint(services) })

    let resolved = await resolveWorkflow(args.workflow ?? (kind === 'video' ? 'txt2video' : 'txt2img'), workflowsDir)
    if (!('workflow' in resolved)) {
      return json({
        error: `workflow "${args.workflow ?? (kind === 'video' ? 'txt2video' : 'txt2img')}" not found. Available: ${resolved.available
          .map((w) => `${w.name}(${w.source})`)
          .join(', ')}. Put your own ComfyUI API-format workflow JSON into ${workflowsDir} (export via "Save (API Format)" in ComfyUI).`,
      })
    }

    const client = new ComfyClient(target.key, config.httpTimeoutMs)
    const available = await client.listModels().catch(() => ({} as Record<string, string[]>))

    // Default txt2img assumes a checkpoint; when this node only has separate
    // diffusion models (Qwen-Image / Flux unet style), fall back to txt2img-unet.
    if (!args.workflow && kind === 'image' && resolved.name === 'txt2img' && resolved.source === 'builtin') {
      const hasCkpt = (available.checkpoints ?? []).length > 0
      const hasUnet = (available.diffusionModels ?? []).length > 0
      if (!hasCkpt && hasUnet) {
        const alt = await resolveWorkflow('txt2img-unet', workflowsDir)
        if ('workflow' in alt) resolved = alt
      }
    }

    const { workflow, notes, errors } = applyParams(resolved.workflow, {
      prompt: args.prompt,
      negative: args.negative,
      width: args.width,
      height: args.height,
      steps: args.steps,
      cfg: args.cfg,
      seed: args.seed,
      batch: args.batch,
      model: args.model,
      frames: args.frames,
      fps: args.fps,
      filenamePrefix: args.filenamePrefix,
    }, {
      checkpoints: available.checkpoints,
      diffusionModels: available.diffusionModels,
      clip: available.clip,
      vae: available.vae,
    })
    if (errors.length) {
      return json({
        error: `workflow "${resolved.name}" cannot run on ${target.key}: ${errors.join('; ')}. Use lan_model_status to inspect this node's model inventory, or pick a custom workflow.`,
        node: target.key,
      })
    }

    const clientId = crypto.randomUUID()
    const { promptId } = await client.submit(workflow, clientId)
    const timeoutMs = (kind === 'video' ? config.videoTimeoutMinutes : config.imageTimeoutMinutes) * 60_000
    const entry = await client.waitPrompt(promptId, timeoutMs, {
      signal: exec.signal,
      onTick: (q) => void q,
    })
    if (entry.status && entry.status.status_str && entry.status.status_str !== 'success' && Object.keys(entry.outputs ?? {}).length === 0) {
      // Surface the server-side execution_error (node type + exception) for fast diagnosis.
      const messages = (entry.status.messages ?? []) as unknown[]
      const execErr = messages.find((m) => Array.isArray(m) && String(m[0]).includes('execution_error')) as
        | { node_type?: string; exception_message?: string; exception_type?: string }
        | undefined
      return json({
        error: `ComfyUI execution failed${execErr ? ` at ${execErr.node_type ?? '?'}: ${execErr.exception_message ?? execErr.exception_type}` : ` with status "${entry.status.status_str}"`}`,
        promptId,
        node: target.key,
      })
    }
    const saved = await saveOutputs(client, entry, outputsDir, resolved.name)
    return json({
      node: target.alias ? `${target.alias} (${target.key})` : target.key,
      workflow: `${resolved.name} (${resolved.source})`,
      promptId,
      outputs: saved,
      notes,
    })
  }

  const imageTool = defineTool({
    name: 'lan_generate_image',
    description:
      '在局域网 ComfyUI 节点上生图。内置 txt2img / txt2img-unet 通用工作流，自动探测节点可用模型；也支持自定义工作流（放在 workflows 目录）。返回产物文件路径。',
    parameters: genParams({ batch: { type: 'integer', description: '一次生成的张数' }, filenamePrefix: filenamePrefixParam }),
    output: {
      schema: { type: 'json' },
      render: (args, value) => {
        const v = value as { error?: string; outputs?: { files: { path: string }[] }; node?: string; workflow?: string; notes?: string[] }
        if (v.error) return [{ type: 'text', text: `❌ ${v.error}` }]
        const files = v.outputs?.files.map((f) => f.path).join('\n') ?? ''
        return [
          {
            type: 'text',
            text: `🖼️ image ready on ${v.node} via ${v.workflow}\n${files}${v.notes?.length ? `\nnotes: ${v.notes.join('; ')}` : ''}\nprompt: ${String((args as { prompt?: string }).prompt ?? '')}`,
          },
        ]
      },
    },
    isConcurrencySafe: () => true,
    timeoutMs: (config.imageTimeoutMinutes + 2) * 60_000,
    execute: async (args, exec: ExecCtx) => runGeneration('image', args, exec),
  })
  tools.register(imageTool)

  tools.register(
    defineTool({
      name: 'lan_generate_video',
      description:
        '在局域网 ComfyUI 节点上生视频（Wan/HunyuanVideo/H3 等）。需要在 workflows 目录放置对应模型的 API 格式工作流（名为 txt2video.json 或通过 workflow 参数指定）；参数自动填入提示词/分辨率/帧数/种子等节点。',
      parameters: genParams({
        frames: { type: 'integer', description: '总帧数（映射到工作流的 length/num_frames 输入）' },
        fps: { type: 'integer', description: '帧率（映射到视频合成节点的 frame_rate）' },
        filenamePrefix: filenamePrefixParam,
      }),
      output: {
        schema: { type: 'json' },
        render: (args, value) => {
          const v = value as { error?: string; outputs?: { files: { path: string }[] }; node?: string; workflow?: string }
          if (v.error) return [{ type: 'text', text: `❌ ${v.error}` }]
          return [
            {
              type: 'text',
              text: `🎬 video ready on ${v.node} via ${v.workflow}\n${v.outputs?.files.map((f) => f.path).join('\n') ?? ''}\nprompt: ${String((args as { prompt?: string }).prompt ?? '')}`,
            },
          ]
        },
      },
      isConcurrencySafe: () => true,
      timeoutMs: (config.videoTimeoutMinutes + 2) * 60_000,
      execute: async (args, exec: ExecCtx) => runGeneration('video', args, exec),
    }),
  )

  tools.register(
    defineTool({
      name: 'lan_chat',
      description:
        '把一段对话/补全请求发给局域网内的本地 LLM（oMLX / vLLM / Ollama / LM Studio 等 OpenAI 兼容服务）。适合把子任务（翻译、摘要、改写、代码评审等）分流到本地模型。',
      parameters: {
        prompt: { type: 'string', description: '单条用户消息（与 messages 二选一）' },
        messages: {
          type: 'array',
          description: '完整对话消息列表（与 prompt 二选一）',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['system', 'user', 'assistant'], required: true },
              content: { type: 'string', required: true },
            },
            additionalProperties: true,
          },
        },
        system: { type: 'string', description: 'system 提示词' },
        model: { type: 'string', description: '模型 id（支持模糊匹配）；不填取该服务第一个模型' },
        node: { type: 'string', description: '服务：alias、URL 片段或 IP；不填自动选择' },
        maxTokens: { type: 'integer', description: '最大生成 token 数' },
        temperature: { type: 'number', description: '采样温度' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => {
          const v = value as { error?: string; content?: string; reasoning?: string; model?: string; node?: string }
          if (v.error) return [{ type: 'text', text: `❌ ${v.error}` }]
          const head = `[${v.model} @ ${v.node}]`
          return [{ type: 'text', text: v.reasoning ? `${head}\n<think>\n${v.reasoning}\n</think>\n${v.content}` : `${head}\n${v.content}` }]
        },
      },
      isConcurrencySafe: () => true,
      timeoutMs: (config.chatTimeoutSeconds + 30) * 1000,
      execute: async (
        args: { prompt?: string; messages?: { role: string; content: string }[]; system?: string; model?: string; node?: string; maxTokens?: number; temperature?: number },
        exec: ExecCtx,
      ) => {
        let messages: ChatMessage[]
        if (args.messages?.length) {
          messages = args.messages.map((m) => ({ role: (m.role === 'system' || m.role === 'assistant' ? m.role : 'user') as ChatMessage['role'], content: m.content }))
        } else if (args.prompt) {
          messages = [{ role: 'user', content: args.prompt }]
        } else {
          return json({ error: 'provide either prompt or messages' })
        }
        if (args.system) messages = [{ role: 'system', content: args.system }, ...messages]

        const services = await registry.scan({})
        const picked = registry.pickOpenAI(services, args.node, args.model)
        if (!picked) {
          const up = services.filter((s) => s.kind === 'openai')
          return json({
            error: up.length
              ? `no up OpenAI-compatible service matches "${args.node ?? '*'}" with model "${args.model ?? '*'}"`
              : 'no OpenAI-compatible LLM service is up on the LAN (oMLX :8000, Ollama :11434, vLLM :8000 …). Start one, or add it to staticHosts.',
          })
        }
        const result = await chatCompletion(picked.record.key, {
          model: picked.model,
          messages,
          maxTokens: args.maxTokens,
          temperature: args.temperature,
          timeoutMs: config.chatTimeoutSeconds * 1000,
          signal: exec.signal,
        })
        return json({ node: picked.record.key, ...result })
      },
    }),
  )
}
