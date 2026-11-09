/** Minimal OpenAI-compatible chat client for LAN LLM endpoints (oMLX / vLLM / LM Studio / llama.cpp). */
export async function chatCompletion(baseUrl, opts) {
    const body = {
        messages: opts.messages,
        stream: false,
    };
    if (opts.model)
        body.model = opts.model;
    if (opts.maxTokens != null)
        body.max_tokens = opts.maxTokens;
    if (opts.temperature != null)
        body.temperature = opts.temperature;
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 300_000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`chat completions ${res.status}: ${text.slice(0, 400)}`);
    }
    const json = (await res.json());
    const msg = json.choices?.[0]?.message;
    return {
        content: msg?.content ?? '',
        reasoning: msg?.reasoning_content || undefined,
        model: json.model ?? opts.model ?? '(unknown)',
        usage: {
            promptTokens: json.usage?.prompt_tokens,
            completionTokens: json.usage?.completion_tokens,
        },
    };
}
/** List models from an OpenAI-compatible endpoint. */
export async function listModels(baseUrl, timeoutMs = 5000) {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok)
        throw new Error(`list models ${res.status}`);
    const json = (await res.json());
    return (json.data ?? []).map((m) => m.id).filter((id) => typeof id === 'string');
}
