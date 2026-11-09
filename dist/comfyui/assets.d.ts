/** Download generation outputs into a per-run directory. */
import type { ComfyClient, ComfyHistoryEntry } from './client.js';
export interface SavedOutput {
    dir: string;
    files: {
        path: string;
        bytes: number;
    }[];
}
export declare function saveOutputs(client: ComfyClient, entry: ComfyHistoryEntry, outRoot: string, tag?: string): Promise<SavedOutput>;
