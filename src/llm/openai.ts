/** Minimal OpenAI-compatible chat client for LAN LLM endpoints (oMLX / vLLM / LM Studio / llama.cpp). */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model?: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ChatResult {
  content: string
  /** Some backends (oMLX thinking models) split reasoning into a separate field. */
  reasoning?: string
  model: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

export async function chatCompletion(baseUrl: string, opts: ChatOptions): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    messages: opts.messages,
    stream: false,
  }
  if (opts.model) body.model = opts.model
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens
  if (opts.temperature != null) body.temperature = opts.temperature

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 300_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`chat completions ${res.status}: ${text.slice(0, 400)}`)
  }
  const json = (await res.json()) as {
    model?: string
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    choices?: { message?: { content?: string; reasoning_content?: string } }[]
  }
  const msg = json.choices?.[0]?.message
  return {
    content: msg?.content ?? '',
    reasoning: msg?.reasoning_content || undefined,
    model: json.model ?? opts.model ?? '(unknown)',
    usage: {
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
    },
  }
}

/** List models from an OpenAI-compatible endpoint. */
export async function listModels(baseUrl: string, timeoutMs = 5000): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`list models ${res.status}`)
  const json = (await res.json()) as { data?: { id?: string }[] }
  return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
}
