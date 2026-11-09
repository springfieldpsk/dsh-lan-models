/**
 * Fill a ComfyUI API-format workflow from natural generation params.
 * Heuristics are driven by class_type and the sampler's positive/negative wiring,
 * so both built-in templates and user-exported workflows work without tagging.
 */
import type { WorkflowApi } from './client.js';
export interface GenParams {
    prompt?: string;
    negative?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfg?: number;
    seed?: number;
    batch?: number;
    model?: string;
    /** Video: frame count (maps to `length`-style inputs). */
    frames?: number;
    /** Video: frame rate (maps to VHS_VideoCombine.frame_rate etc.). */
    fps?: number;
    filenamePrefix?: string;
}
export interface AvailableModels {
    checkpoints?: string[];
    diffusionModels?: string[];
    clip?: string[];
    vae?: string[];
}
export interface FillResult {
    workflow: WorkflowApi;
    /** Human-readable notes about what was filled / could not be filled. */
    notes: string[];
    /** Fatal problems: a loader still has no usable model — do not submit. */
    errors: string[];
}
export declare function applyParams(input: WorkflowApi, params: GenParams, available?: AvailableModels): FillResult;
