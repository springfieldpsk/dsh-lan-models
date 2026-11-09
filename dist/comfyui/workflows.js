/**
 * Workflow registry: built-in generic templates plus user-provided API-format
 * workflows from a config directory (same name overrides built-in).
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
/** Built-in checkpoint-style txt2img (SD1.5 / SDXL / Flux checkpoint). */
const txt2img = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '' }, _meta: { title: 'Load Checkpoint' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] }, _meta: { title: 'Positive Prompt' } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] }, _meta: { title: 'Negative Prompt' } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '5': {
        class_type: 'KSampler',
        inputs: {
            seed: 0,
            steps: 25,
            cfg: 4.5,
            sampler_name: 'euler',
            scheduler: 'simple',
            denoise: 1,
            model: ['1', 0],
            positive: ['2', 0],
            negative: ['3', 0],
            latent_image: ['4', 0],
        },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { filename_prefix: 'dsh_lan', images: ['6', 0] } },
};
/** Built-in diffusion-model style txt2img (UNET + separate CLIP/VAE, e.g. Qwen-Image / Flux unet). */
const txt2imgUnet = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: '', weight_dtype: 'default' }, _meta: { title: 'Load Diffusion Model' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: '', type: 'flux' }, _meta: { title: 'Load CLIP' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: '' }, _meta: { title: 'Load VAE' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] }, _meta: { title: 'Positive Prompt' } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] }, _meta: { title: 'Negative Prompt' } },
    '6': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '7': {
        class_type: 'KSampler',
        inputs: {
            seed: 0,
            steps: 25,
            cfg: 4.5,
            sampler_name: 'euler',
            scheduler: 'simple',
            denoise: 1,
            model: ['1', 0],
            positive: ['4', 0],
            negative: ['5', 0],
            latent_image: ['6', 0],
        },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'dsh_lan', images: ['8', 0] } },
};
export const BUILTIN_WORKFLOWS = {
    txt2img: txt2img,
    'txt2img-unet': txt2imgUnet,
};
/** Basic structural validation of an API-format workflow. */
export function isValidWorkflowApi(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v))
        return false;
    for (const node of Object.values(v)) {
        if (!node || typeof node !== 'object' || Array.isArray(node))
            return false;
        const n = node;
        if (typeof n.class_type !== 'string' || !n.class_type)
            return false;
        if (!n.inputs || typeof n.inputs !== 'object' || Array.isArray(n.inputs))
            return false;
    }
    return true;
}
/** Load *.json workflows from a user directory. Invalid files are skipped and reported. */
export async function loadCustomWorkflows(dir) {
    const workflows = {};
    const errors = [];
    let entries;
    try {
        entries = await fs.readdir(dir);
    }
    catch {
        return { workflows, errors: [`cannot read workflows directory: ${dir}`] };
    }
    for (const file of entries.filter((f) => f.toLowerCase().endsWith('.json')).sort()) {
        const name = file.replace(/\.json$/i, '');
        try {
            const raw = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
            // Accept both bare API format and {"workflow": ...} wrappers (defensive).
            const candidate = raw?.workflow ?? raw;
            if (!isValidWorkflowApi(candidate)) {
                errors.push(`${file}: not a ComfyUI API-format workflow (export via "Save (API Format)")`);
                continue;
            }
            workflows[name] = candidate;
        }
        catch (err) {
            errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return { workflows, errors };
}
/** Resolve a workflow by name: custom dir wins over built-ins. */
export async function resolveWorkflow(name, customDir) {
    const custom = customDir ? await loadCustomWorkflows(customDir) : { workflows: {}, errors: [] };
    const merged = {};
    for (const [n, wf] of Object.entries(BUILTIN_WORKFLOWS))
        merged[n] = { wf, source: 'builtin' };
    for (const [n, wf] of Object.entries(custom.workflows))
        merged[n] = { wf, source: 'custom' };
    const picked = name ?? 'txt2img';
    const hit = merged[picked];
    if (hit)
        return { name: picked, workflow: hit.wf, source: hit.source };
    return {
        available: Object.entries(merged)
            .map(([n, v]) => ({ name: n, source: v.source }))
            .sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name)),
    };
}
