/** Minimal OpenAI-compatible chat client for LAN LLM endpoints (oMLX / vLLM / LM Studio / llama.cpp). */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface ChatOptions {
    model?: string;
    messages: ChatMessage[];
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface ChatResult {
    content: string;
    /** Some backends (oMLX thinking models) split reasoning into a separate field. */
    reasoning?: string;
    model: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
    };
}
export declare function chatCompletion(baseUrl: string, opts: ChatOptions): Promise<ChatResult>;
/** List models from an OpenAI-compatible endpoint. */
export declare function listModels(baseUrl: string, timeoutMs?: number): Promise<string[]>;
