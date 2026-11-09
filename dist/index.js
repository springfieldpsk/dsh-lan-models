/**
 * dsh-lan-models — LAN local-model mesh for DeepSeek Harness.
 *
 * Discovers model services across the LAN (ComfyUI / oMLX / Ollama / LM Studio /
 * vLLM / llama.cpp), exposes status + model inventories, drives ComfyUI image &
 * video generation with built-in or user workflows, and routes chat to LAN LLMs.
 */
import { Config } from './config.js';
import { LanRegistry } from './discovery/registry.js';
import { registerTools } from './tools.js';
import { registerCommands } from './commands.js';
import { registerSkills } from './skills.js';
export const name = 'dsh-lan-models';
export const inject = ['tools'];
export { Config };
export function apply(ctx, config) {
    const staticHosts = (config.staticHosts ?? [])
        .map((h) => ({ url: h.url, alias: h.alias || undefined }))
        .filter((h) => !!h.url);
    const registry = new LanRegistry({
        cidrs: config.extraCidrs,
        ports: config.ports,
        tcpTimeoutMs: config.tcpTimeoutMs,
        httpTimeoutMs: config.httpTimeoutMs,
        concurrency: config.concurrency,
        staticHosts,
        cacheTtlMs: config.cacheTtlSeconds * 1000,
        scanDeadlineMs: config.scanDeadlineSeconds * 1000,
    });
    registerTools(ctx.tools, config, registry);
    // commands / skills are optional seams: register when the profile provides them.
    const commands = ctx.get?.('commands');
    const skills = ctx.get?.('skills');
    registerCommands(commands, config, registry);
    registerSkills(skills, config);
}
