/** HTTP fingerprinting: identify what model service listens on an open host:port. */
import type { ModelRef, ServiceKind, ServiceMeta } from '../types.js';
export interface ProbeResult {
    kind: ServiceKind;
    software?: string;
    models: ModelRef[];
    meta?: ServiceMeta;
}
/** Fingerprint one open host:port. Returns null when nothing recognizable answers. */
export declare function probeService(host: string, port: number, timeoutMs?: number): Promise<ProbeResult | null>;
