/** Low-level network helpers: subnet detection, CIDR expansion, TCP probing. */
import * as os from 'node:os';
/** 169.254.0.0/16 (IPv4 link-local / APIPA) is never a routable LAN segment. */
export declare function isLinkLocal(ip: string): boolean;
/**
 * Pick the CIDRs a scan should sweep from a network-interface table.
 *
 * A full sweep costs `hosts × ports` TCP probes, so auto-detection must stay small:
 * - loopback / link-local (169.254/16) are skipped;
 * - virtual switches, container bridges and VPN adapters are skipped by name;
 * - a prefix wider than /23 (e.g. a Hyper-V /20 or a real /16 LAN) is narrowed to
 *   the /24 containing the address. Explicit `cidr` arguments from the tool are
 *   still expanded literally, so a genuine wide LAN can be requested by hand.
 */
export declare function selectScanCidrs(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[];
/** Detect local IPv4 CIDRs worth scanning (see {@link selectScanCidrs}). */
export declare function detectLocalCidrs(): string[];
/**
 * Expand a CIDR (IPv4) to its usable host addresses.
 * For prefixes <= 30 the network and broadcast addresses are skipped;
 * /31 and /32 return both/one address as-is. Prefixes below /16 are
 * rejected to keep scan ranges bounded.
 */
export declare function expandCidr(cidr: string): string[];
/** Probe a single TCP port with a connection timeout. Resolves true/false, never rejects. */
export declare function tcpProbe(host: string, port: number, timeoutMs?: number): Promise<boolean>;
/** Run `fn` over `items` with bounded concurrency, preserving order. */
export declare function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>;
