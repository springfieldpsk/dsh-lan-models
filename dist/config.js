/** Plugin configuration schema (Schemastery). */
import * as os from 'node:os';
import * as path from 'node:path';
import z from '@deepseek-ai/schemastery';
export const Config = z.object({
    extraCidrs: z.array(z.string()).default([]).description('额外扫描的网段，如 "192.168.5.0/24"（自动探测本机网段之外的补充）'),
    ports: z
        .array(z.number().step(1).min(1).max(65535))
        .default([8000, 8080, 8188, 8888, 11434, 1234, 7860, 9997])
        .description('每台主机探测的端口（oMLX/vLLM 8000、llama.cpp 8080、ComfyUI 8188、Windows 中继 8888、Ollama 11434、LM Studio 1234 等）'),
    tcpTimeoutMs: z.number().step(1).min(50).max(10000).default(400).description('单个 TCP 探测超时（毫秒）'),
    httpTimeoutMs: z.number().step(1).min(200).max(30000).default(2500).description('单个 HTTP 指纹识别超时（毫秒）'),
    concurrency: z.number().step(1).min(1).max(512).default(64).description('并发 TCP 探测数'),
    scanDeadlineSeconds: z
        .number()
        .step(1)
        .min(5)
        .max(600)
        .default(120)
        .description('单次扫描的总时限（秒）；到点后用已探测结果返回并标记 truncated'),
    staticHosts: z
        .array(z.object({ url: z.string(), alias: z.string().default('') }))
        .default([{ url: 'http://127.0.0.1:8000', alias: '' }])
        .description('静态服务地址（扫描发现不了的回环绑定服务或固定机器），alias 便于工具选择，如 { url: "http://127.0.0.1:8000", alias: "mac-llm" }'),
    cacheTtlSeconds: z.number().step(1).min(0).max(3600).default(60).description('扫描结果缓存秒数'),
    workflowsDir: z.string().default('').description('自定义 ComfyUI 工作流目录（API 格式 JSON）；留空则用 $DSH_HOME/lan-models/workflows'),
    outputsDir: z.string().default('').description('生成产物保存目录；留空则用 $DSH_HOME/lan-models/outputs'),
    imageTimeoutMinutes: z.number().step(1).min(1).max(120).default(10).description('单次生图的最长等待（分钟）'),
    videoTimeoutMinutes: z.number().step(1).min(1).max(1440).default(60).description('单次生视频的最长等待（分钟）'),
    chatTimeoutSeconds: z.number().step(1).min(5).max(3600).default(300).description('单次 LLM 补全的最长等待（秒）'),
});
/** Resolve $DSH_HOME (default ~/.dsh) the same way the harness does. */
export function dshHome() {
    return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
}
export function resolveWorkflowsDir(config) {
    return config.workflowsDir || path.join(dshHome(), 'lan-models', 'workflows');
}
export function resolveOutputsDir(config) {
    return config.outputsDir || path.join(dshHome(), 'lan-models', 'outputs');
}
