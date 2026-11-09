/**
 * The five agent-facing tools:
 *   lan_scan / lan_model_status / lan_generate_image / lan_generate_video / lan_chat
 */
import type { Config } from './config.js';
import type { LanRegistry } from './discovery/registry.js';
export interface ToolRegistryLike {
    register(def: unknown): () => void;
}
export declare function registerTools(tools: ToolRegistryLike, config: Config, registry: LanRegistry): void;
