/** ComfyUI HTTP API client (workflow submit / poll / fetch outputs). */
/** ComfyUI API-format workflow: node id -> { class_type, inputs, _meta? }. */
export type WorkflowApi = Record<string, {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: {
        title?: string;
    };
}>;
export interface ComfySubmitResult {
    promptId: string;
    number: number;
}
export interface ComfyHistoryEntry {
    status?: {
        completed?: boolean;
        status_str?: string;
        messages?: unknown[];
    };
    outputs?: Record<string, {
        images?: ComfyFileRef[];
        gifs?: ComfyFileRef[];
        videos?: ComfyFileRef[];
    }>;
}
export interface ComfyFileRef {
    filename: string;
    subfolder?: string;
    type?: string;
}
export interface ComfyModelError extends Error {
    nodeErrors: Record<string, {
        errors: {
            type: string;
            message: string;
            details?: string;
        }[];
    }>;
}
export declare class ComfyClient {
    private baseUrl;
    private timeoutMs;
    constructor(baseUrl: string, timeoutMs?: number);
    private getJson;
    systemStats(): Promise<{
        system?: {
            os?: string;
            ram_total?: number;
            ram_free?: number;
        };
        devices?: {
            name?: string;
            type?: string;
            vram_total?: number;
            vram_free?: number;
        }[];
        comfyui_version?: string;
    }>;
    queue(): Promise<{
        running: number;
        pending: number;
    }>;
    objectInfo(): Promise<Record<string, {
        input?: {
            required?: Record<string, unknown[]>;
            optional?: Record<string, unknown[]>;
        };
    }>>;
    /** Model lists (checkpoints / unets / vae / clip / loras) from /object_info. */
    listModels(): Promise<Record<string, string[]>>;
    /** Submit an API-format workflow. Throws ComfyModelError with per-node details on validation failure. */
    submit(workflow: WorkflowApi, clientId: string): Promise<ComfySubmitResult>;
    history(promptId: string): Promise<ComfyHistoryEntry | null>;
    /** Poll /history until the prompt finishes; resolves with its entry, rejects on timeout/abort. */
    waitPrompt(promptId: string, timeoutMs: number, opts?: {
        pollMs?: number;
        onTick?: (status: {
            running: number;
            pending: number;
        }) => void;
        signal?: AbortSignal;
    }): Promise<ComfyHistoryEntry>;
    /** Collect output file references (images/gifs/videos) from a history entry. */
    collectFiles(entry: ComfyHistoryEntry): ComfyFileRef[];
    download(ref: ComfyFileRef, timeoutMs?: number): Promise<{
        buffer: ArrayBuffer;
        contentType: string;
    }>;
    /** Interrupt the running prompt (best effort). */
    interrupt(): Promise<void>;
}
