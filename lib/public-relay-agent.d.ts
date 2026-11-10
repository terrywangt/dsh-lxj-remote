import { type AgentCapability } from './agent-metadata.js';
import type { HostPlatformDescriptor } from './host-platform.js';
export declare const DEFAULT_PUBLIC_RELAY_ORIGIN = "https://h-wxrelay.1day.wang";
export interface RelayLeaseOptions {
    readonly leaseDir?: string;
    readonly now?: () => number;
    readonly pid?: number;
}
export declare class RelayTransportLease {
    readonly directory: string;
    private readonly now;
    private readonly pid;
    private readonly token;
    private holder;
    private timer;
    /** `leaseDir` defaults beside the caller's own base directory, i.e. next to
     * the identity.json it guards, so the lease inherits the exact instance
     * storage scope of the key and follows portable/test overrides. */
    constructor(nodeId: string, identityDirectory: string, options?: RelayLeaseOptions);
    /** True when this process may enroll and connect; false means "another live
     * process already owns this node, so stay quiet instead of fighting it". */
    acquire(): boolean;
    /** Keep the lease alive; reports whether we still hold it. */
    renew(): boolean;
    release(): void;
    startRenewal(onLost: () => void): void;
    private static processAlive;
    private read;
    private write;
}
export interface PublicRelayConfig {
    readonly enabled: boolean;
    readonly relayOrigin: string;
    /** Optional exact HTTPS origins for a self-hosted encrypted object store. */
    readonly objectOrigins?: readonly string[];
}
export interface AgentIdentity {
    readonly nodeId: string;
    readonly publicKeyPem: string;
    readonly privateKeyPem: string;
}
export type RemoteAccessState = 'active' | 'expired' | 'suspended' | 'not_entitled';
export interface RemoteAccessStatus {
    readonly status: RemoteAccessState;
    readonly validUntil?: number | null;
}
export interface AgentStatus {
    readonly enabled: boolean;
    readonly state: 'disabled' | 'enrolling' | 'connecting' | 'online' | 'offline';
    readonly nodeId?: string;
    readonly identityPublicKey?: string;
    readonly relayOrigin?: string;
    readonly pairingTicket?: string;
    readonly pairingExpiresAt?: number;
    readonly lastError?: string;
    readonly hostId?: string;
    readonly agentInstanceId?: string;
    readonly hostName?: string;
    readonly agentKind?: string;
    readonly agentName?: string;
    readonly agentVersion?: string;
    readonly adapterVersion?: string;
    readonly hostPlatform?: HostPlatformDescriptor;
    readonly capabilities?: readonly AgentCapability[];
    readonly remoteAccess?: RemoteAccessStatus;
}
export interface RelayClientFrame {
    readonly clientId: string;
    readonly payload: Buffer;
    reply(payload: Uint8Array): Promise<void>;
}
export interface PublicRelayAgentOptions {
    readonly agentVersion: string;
    readonly adapterVersion?: string;
    readonly hostId?: string;
    readonly agentInstanceId?: string;
    readonly agentKind?: string;
    readonly agentName?: string;
    readonly hostName?: string;
    readonly hostPlatform?: HostPlatformDescriptor;
    readonly capabilities?: readonly AgentCapability[];
    readonly displayName?: string;
    readonly onFrame: (frame: RelayClientFrame) => void | Promise<void>;
    readonly onStatus?: (status: AgentStatus) => void;
    readonly onClientDisconnect?: (clientId: string) => void;
    readonly onClientError?: (clientId: string, error: unknown) => void;
    /** The physical Agent socket was lost; all relay client ids are now stale. */
    readonly onTransportDisconnect?: () => void;
    readonly onIdentityChange?: () => void;
    readonly fetchImpl?: typeof fetch;
    /** Test/portable profile override; production defaults to ~/.dsh. */
    readonly identityPath?: string;
    /** Transport-test timing overrides; no client protocol or user settings change. */
    readonly transportTiming?: {
        readonly pingIntervalMs?: number;
        readonly pongTimeoutMs?: number;
        readonly handshakeTimeoutMs?: number;
        readonly connectSettleMs?: number;
    };
    /** Cross-process relay transport lease. Production (the host gate) enables
     * it so a second holder of the same node identity cannot evict the live
     * relay socket; it defaults to off so single-process fixtures, which freely
     * reuse one identity file across restarts, keep their existing semantics. */
    readonly lease?: {
        readonly enabled: boolean;
        readonly directory?: string;
    };
}
export declare function agentNodeIdForPublicKey(publicKeyPem: string): string;
export declare function loadPublicRelayConfig(configPath?: string): PublicRelayConfig | null;
export declare function loadOrCreateAgentIdentity(identityPath?: string): AgentIdentity;
export declare class PublicRelayAgent {
    readonly config: PublicRelayConfig;
    identity: AgentIdentity;
    readonly options: PublicRelayAgentOptions;
    readonly fetchImpl: typeof fetch;
    private readonly identityPath;
    private socket;
    private stopped;
    private reconnectAttempt;
    private reconnectTimer;
    private clearHeartbeat;
    private lifecycleRevision;
    private enrollment;
    /** Last successful enrollment, reused only to rate-limit pairing refreshes. */
    private lastEnrollment;
    /** True while enrollAndConnect holds the lifecycle, so a pairing refresh can
     * never open a second transport racing the scheduled reconnect. */
    private lifecycleInFlight;
    /** Cross-process guard, one per node identity; null when disabled. */
    private lease;
    private status;
    constructor(config: PublicRelayConfig, options: PublicRelayAgentOptions);
    snapshot(): AgentStatus;
    /** Read account features with this node's existing proof; never mobile state. */
    readFeatures(signal: AbortSignal): Promise<unknown>;
    start(): Promise<void>;
    /** Another live process owns this node's relay transport: stay silent
     * instead of enrolling and evicting it. Re-check on a fixed quiet cadence,
     * never with the error backoff, and never touch the socket or ticket state
     * the holder owns. */
    private yieldLease;
    /** Background status can reuse a ticket; an explicit pairing surface must
     * refresh because an unexpired single-use ticket may already be consumed.
     * Enrollment retains the existing identity and owner (except revoked keys).
     */
    ensurePairingTicket(minValidityMs?: number, options?: {
        readonly refresh?: boolean;
    }): Promise<AgentStatus>;
    stop(): void;
    private enrollAndConnect;
    private enrollWithIdentityRecovery;
    private rotateRevokedIdentity;
    private enroll;
    private connect;
    private scheduleReconnect;
    private dispatchFrame;
    private sendRouted;
    private update;
}
/** Additive QR v1 compatibility. `relay` is the original wire field;
 * released clients also inspect `relayOrigin` before deciding whether to
 * claim or recover a LAN route. Both must always come from the same identity
 * status, never independent configuration or user-supplied aliases.
 */
export declare function publicPairingPayload(status: AgentStatus, lan?: {
    readonly host: string;
    readonly port: number;
}): string | null;
