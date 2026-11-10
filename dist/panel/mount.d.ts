/**
 * "装载" half of the panel: turn one discovered OpenAI-compatible endpoint into
 * an `llm-pi-ai` provider route, so the model shows up in dsh's model selector
 * and can be switched per session.
 *
 * We deliberately reuse the pi-ai adapter instead of writing our own
 * `LlmAdapter`: the route config below is the same shape the official Models
 * page writes, and configEditor.edit() persists it and lets the Loader
 * reconcile, so no new wire-protocol code lives in this plugin.
 */
import type { Context } from '@deepseek-ai/cordis';
export interface LanModelSpec {
    id: string;
    name?: string;
    contextWindow?: number;
}
export interface MountSpec {
    providerId: string;
    displayName: string;
    baseURL: string;
    models: LanModelSpec[];
    /** Bearer token for endpoints that require one (oMLX refuses a non-loopback bind without a key). */
    apiKey?: string;
}
export interface MountedProvider {
    providerId: string;
    displayName: string;
    baseURL?: string;
    modelCount: number;
    models: string[];
}
/** Providers this plugin has loaded, read from the live pi-ai configuration. */
export declare function listMounted(ctx: Context): MountedProvider[];
/** Stable route key for one discovered endpoint, e.g. `lan-192-168-5-115-8000`. */
export declare function providerIdFor(key: string): string;
/** Accept `http://host:port`, `http://host:port/`, `http://host:port/v1`; add `/v1` when bare. */
export declare function normalizeBaseUrl(raw: string): string;
export declare function mountProvider(ctx: Context, spec: MountSpec): Promise<MountedProvider>;
export declare function unmountProvider(ctx: Context, providerId: string): Promise<void>;
