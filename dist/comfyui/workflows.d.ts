/**
 * Workflow registry: built-in generic templates plus user-provided API-format
 * workflows from a config directory (same name overrides built-in).
 */
import type { WorkflowApi } from './client.js';
export declare const BUILTIN_WORKFLOWS: Record<string, WorkflowApi>;
/** Basic structural validation of an API-format workflow. */
export declare function isValidWorkflowApi(v: unknown): v is WorkflowApi;
/** Load *.json workflows from a user directory. Invalid files are skipped and reported. */
export declare function loadCustomWorkflows(dir: string): Promise<{
    workflows: Record<string, WorkflowApi>;
    errors: string[];
}>;
export interface ResolvedWorkflow {
    name: string;
    workflow: WorkflowApi;
    source: 'builtin' | 'custom';
}
/** Resolve a workflow by name: custom dir wins over built-ins. */
export declare function resolveWorkflow(name: string | undefined, customDir?: string): Promise<ResolvedWorkflow | {
    available: {
        name: string;
        source: 'builtin' | 'custom';
    }[];
}>;
