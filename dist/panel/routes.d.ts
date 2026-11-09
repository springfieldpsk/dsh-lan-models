/**
 * Loopback JSON routes behind the settings panel. The browser half is a
 * hand-written client bundle that talks to these routes with plain fetch, so
 * no typert remote schema has to be published for a settings page.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config } from '../config.js';
import type { LanRegistry } from '../discovery/registry.js';
export declare function registerLanPanelRoutes(ctx: Context, registry: LanRegistry, _config: Config): () => void;
