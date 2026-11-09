/** Shared formatting helpers for tool render and the /lan command. */
import type { ServiceRecord } from './types.js';
export declare function formatServiceLine(r: ServiceRecord): string;
export declare function formatScan(records: ServiceRecord[]): string;
