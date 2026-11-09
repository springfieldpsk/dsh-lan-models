/** Plugin configuration schema (Schemastery). */
import z from '@deepseek-ai/schemastery';
export interface StaticHostConfig {
    url: string;
    alias?: string;
}
export interface Config {
    /** Extra CIDRs to scan beyond auto-detected local subnets, e.g. "192.168.5.0/24". */
    extraCidrs: string[];
    /** Ports probed on every host. */
    ports: number[];
    /** TCP connect timeout per probe. */
    tcpTimeoutMs: number;
    /** HTTP fingerprint timeout per service. */
    httpTimeoutMs: number;
    /** Max concurrent TCP probes. */
    concurrency: number;
    /** Hard upper bound for one full sweep; partial results are reported when hit. */
    scanDeadlineSeconds: number;
    /** Services that scanning cannot see (loopback-bound) or that should always be listed. */
    staticHosts: StaticHostConfig[];
    /** Scan result cache lifetime. */
    cacheTtlSeconds: number;
    /** Directory with custom ComfyUI API-format workflows. Empty = "$DSH_HOME/lan-models/workflows". */
    workflowsDir: string;
    /** Directory where generation outputs are saved. Empty = "$DSH_HOME/lan-models/outputs". */
    outputsDir: string;
    /** Upper bound for one image generation to finish. */
    imageTimeoutMinutes: number;
    /** Upper bound for one video generation to finish. */
    videoTimeoutMinutes: number;
    /** Upper bound for one chat completion. */
    chatTimeoutSeconds: number;
}
export declare const Config: z<Config>;
/** Resolve $DSH_HOME (default ~/.dsh) the same way the harness does. */
export declare function dshHome(): string;
export declare function resolveWorkflowsDir(config: Config): string;
export declare function resolveOutputsDir(config: Config): string;
