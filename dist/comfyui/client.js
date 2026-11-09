/** ComfyUI HTTP API client (workflow submit / poll / fetch outputs). */
export class ComfyClient {
    baseUrl;
    timeoutMs;
    constructor(baseUrl, timeoutMs = 10_000) {
        this.baseUrl = baseUrl;
        this.timeoutMs = timeoutMs;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    async getJson(path, timeoutMs = this.timeoutMs) {
        const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok)
            throw new Error(`GET ${path} -> ${res.status}`);
        return (await res.json());
    }
    systemStats() {
        return this.getJson('/system_stats');
    }
    queue() {
        return this.getJson('/queue').then((q) => ({
            running: q.queue_running?.length ?? 0,
            pending: q.queue_pending?.length ?? 0,
        }));
    }
    objectInfo() {
        return this.getJson('/object_info', 30_000);
    }
    /** Model lists (checkpoints / unets / vae / clip / loras) from /object_info. */
    async listModels() {
        const info = await this.objectInfo();
        const pick = (cls, field) => {
            const entry = info[cls]?.input?.required?.[field] ?? info[cls]?.input?.optional?.[field];
            // Combo inputs look like [["a.safetensors","b.safetensors"], {tooltip}]
            if (Array.isArray(entry) && Array.isArray(entry[0]))
                return entry[0].filter((x) => typeof x === 'string');
            return [];
        };
        return {
            checkpoints: pick('CheckpointLoaderSimple', 'ckpt_name'),
            diffusionModels: [...pick('UNETLoader', 'unet_name'), ...pick('UnetLoaderGGUF', 'unet_name')],
            vae: pick('VAELoader', 'vae_name'),
            clip: pick('CLIPLoader', 'clip_name'),
            loras: pick('LoraLoader', 'lora_name'),
        };
    }
    /** Submit an API-format workflow. Throws ComfyModelError with per-node details on validation failure. */
    async submit(workflow, clientId) {
        const res = await fetch(`${this.baseUrl}/prompt`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ prompt: workflow, client_id: clientId }),
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        const json = (await res.json().catch(() => ({})));
        // A successful /prompt response also carries `node_errors: {}` — only a
        // non-empty map (or an `error` object) means rejection.
        const nodeErrors = json.node_errors ?? {};
        const hasNodeErrors = Object.keys(nodeErrors).length > 0;
        if (!res.ok || json.error || hasNodeErrors) {
            const err = new Error(`ComfyUI rejected workflow: ${json.error?.message ?? res.status}${hasNodeErrors ? ` (nodes: ${Object.keys(nodeErrors).join(', ')})` : ''}`);
            err.nodeErrors = nodeErrors;
            throw err;
        }
        return { promptId: json.prompt_id, number: json.number ?? -1 };
    }
    async history(promptId) {
        const json = await this.getJson(`/history/${promptId}`);
        return json[promptId] ?? null;
    }
    /** Poll /history until the prompt finishes; resolves with its entry, rejects on timeout/abort. */
    async waitPrompt(promptId, timeoutMs, opts = {}) {
        const { pollMs = 1500, onTick, signal } = opts;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (signal?.aborted)
                throw new Error(`prompt ${promptId} aborted`);
            const entry = await this.history(promptId).catch(() => null);
            if (entry) {
                const done = entry.status?.completed === true || Object.keys(entry.outputs ?? {}).length > 0;
                if (done)
                    return entry;
                if (entry.status?.status_str && entry.status.status_str !== 'executing') {
                    return entry; // failed / cancelled — caller inspects status_str
                }
            }
            else if (onTick) {
                onTick(await this.queue().catch(() => ({ running: 0, pending: 0 })));
            }
            await new Promise((r) => setTimeout(r, pollMs));
        }
        throw new Error(`ComfyUI prompt ${promptId} did not finish within ${Math.round(timeoutMs / 1000)}s (the job stays in the remote queue; check lan_model_status)`);
    }
    /** Collect output file references (images/gifs/videos) from a history entry. */
    collectFiles(entry) {
        const files = [];
        for (const out of Object.values(entry.outputs ?? {})) {
            for (const key of ['images', 'gifs', 'videos']) {
                for (const f of out[key] ?? [])
                    files.push(f);
            }
        }
        return files;
    }
    async download(ref, timeoutMs = 120_000) {
        const params = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder ?? '', type: ref.type ?? 'output' });
        const res = await fetch(`${this.baseUrl}/view?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok)
            throw new Error(`download ${ref.filename} -> ${res.status}`);
        return { buffer: await res.arrayBuffer(), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
    }
    /** Interrupt the running prompt (best effort). */
    async interrupt() {
        await fetch(`${this.baseUrl}/interrupt`, { method: 'POST', signal: AbortSignal.timeout(this.timeoutMs) });
    }
}
