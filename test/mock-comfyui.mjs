/** Mini ComfyUI mock: implements the endpoints the plugin's ComfyClient uses. */

import * as http from 'node:http'
import * as crypto from 'node:crypto'

const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005050201edb5ca9f0000000049454e44ae426082',
  'hex',
)

export function startMockComfyUI(port = 0) {
  const submissions = []
  const done = new Map()

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock')
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type })
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
    }

    if (url.pathname === '/system_stats') {
      return send(200, {
        system: { os: 'macos', ram_total: 274_877_906_944, ram_free: 137_438_953_472 },
        devices: [{ name: 'Apple M5 Ultra', type: 'mps', vram_total: 137_438_953_472, vram_free: 68_719_476_736 }],
        comfyui_version: '0.37.0',
      })
    }
    if (url.pathname === '/queue') {
      return send(200, { queue_running: [[1]], queue_pending: [[2], [3]] })
    }
    if (url.pathname === '/object_info') {
      return send(200, {
        CheckpointLoaderSimple: { input: { required: { ckpt_name: [['mock_sdxl.safetensors', 'flux_fp8.safetensors'], {}] } } },
        UNETLoader: { input: { required: { unet_name: [['qwen_image_bf16.safetensors'], {}] } } },
        UnetLoaderGGUF: { input: { required: { unet_name: [[], {}] } } },
        VAELoader: { input: { required: { vae_name: [['ae.safetensors'], {}] } } },
        CLIPLoader: { input: { required: { clip_name: [['clip_l.safetensors'], {}] } } },
        LoraLoader: { input: { required: { lora_name: [[], {}] } } },
      })
    }
    if (url.pathname === '/prompt' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const parsed = JSON.parse(body)
        submissions.push(parsed.prompt)
        // minimal validation: workflow must be a non-empty object with class_type nodes
        const wf = parsed.prompt
        if (!wf || typeof wf !== 'object' || Object.keys(wf).length === 0) {
          return send(400, { error: { message: 'prompt is empty' }, node_errors: {} })
        }
        const promptId = crypto.randomUUID()
        setTimeout(() => {
          done.set(promptId, { outputs: { '7': { images: [{ filename: 'mock_out_00001_.png', subfolder: '', type: 'output' }] } } })
        }, 200)
        send(200, { prompt_id: promptId, number: 1 })
      })
      return
    }
    if (url.pathname.startsWith('/history/')) {
      const id = url.pathname.slice('/history/'.length)
      const entry = done.get(id)
      if (!entry) return send(200, {})
      return send(200, { [id]: { status: { completed: true, status_str: 'success' }, ...entry } })
    }
    if (url.pathname === '/view') {
      return send(200, PNG_1PX, 'image/png')
    }
    send(404, { error: 'not found' })
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}`,
        submissions,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}
