/** Scan orchestration: CIDR sweep + static hosts, TTL cache, node pickers. */
import type { ServiceRecord } from '../types.js';
export interface StaticHost {
    url: string;
    alias?: string;
    /** Optional expected kind; when omitted the service is fingerprinted. */
    kind?: ServiceRecord['kind'];
}
export interface RegistryOptions {
    /** Extra CIDRs to scan in addition to auto-detected local subnets. Empty = auto only. */
    cidrs?: string[];
    /** Replace auto-detection entirely when set. */
    cidrsOnly?: string[];
    ports?: number[];
    tcpTimeoutMs?: number;
    httpTimeoutMs?: number;
    concurrency?: number;
    staticHosts?: StaticHost[];
    cacheTtlMs?: number;
    /** Hard upper bound for one sweep; unprobed targets are reported as truncated. */
    scanDeadlineMs?: number;
}
export declare const DEFAULT_PORTS: number[];
export interface ScanMeta {
    /** CIDRs actually swept by the last scan. */
    cidrs: string[];
    /** Host × port pairs queued / probed. */
    targets: number;
    /** True when the deadline or MAX_TARGETS cut the sweep short. */
    truncated: boolean;
    /** Wall-clock cost of the last scan. */
    tookMs: number;
}
export declare class LanRegistry {
    private opts;
    private cache;
    private cacheAt;
    private scanning;
    private meta;
    constructor(opts?: RegistryOptions);
    /** What the last scan covered — lets the caller report a truncated sweep. */
    get scanMeta(): ScanMeta;
    /** Full scan (cached for cacheTtlMs unless refresh=true). */
    scan(params?: {
        refresh?: boolean;
        cidr?: string;
    }): Promise<ServiceRecord[]>;
    private doScan;
    private probeStatic;
    private deadStatic;
    /** Re-probe a single service URL for detailed status. */
    statusOf(key: string): Promise<ServiceRecord>;
    /** Pick a ComfyUI node: by alias or URL substring, else the first up node. */
    pickComfyUI(records: ServiceRecord[], pref?: string): ServiceRecord | undefined;
    /** Pick an OpenAI-compatible LLM endpoint, optionally filtering by model id substring. */
    pickOpenAI(records: ServiceRecord[], pref?: string, model?: string): {
        record: ServiceRecord;
        model: string;
    } | undefined;
}
