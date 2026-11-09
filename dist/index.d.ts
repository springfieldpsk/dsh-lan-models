/**
 * dsh-lan-models — LAN local-model mesh for DeepSeek Harness.
 *
 * Discovers model services across the LAN (ComfyUI / oMLX / Ollama / LM Studio /
 * vLLM / llama.cpp), exposes status + model inventories, drives ComfyUI image &
 * video generation with built-in or user workflows, and routes chat to LAN LLMs.
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, type Config as ConfigType } from './config.js';
export declare const name = "dsh-lan-models";
export declare const inject: string[];
export { Config };
export declare function apply(ctx: Context, config: ConfigType): void;
