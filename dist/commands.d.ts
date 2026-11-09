/** `/lan` slash command: one-shot LAN dashboard without an agent round-trip. */
import type { Config } from './config.js';
import type { LanRegistry } from './discovery/registry.js';
interface CommandsService {
    register(def: {
        name: string;
        description: string;
        input?: {
            hint: string;
        };
        handler: (invocation: {
            rawInput: string;
        }) => Promise<{
            kind: 'success';
            text?: string;
        } | {
            kind: 'error';
            text: string;
        }>;
    }): () => void;
}
export declare function registerCommands(commands: CommandsService | undefined, config: Config, registry: LanRegistry): void;
export {};
