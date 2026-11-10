import type { InstallRuntime } from './install-runtime.js';
export declare const PLUGIN_PACKAGE = "dsh-lxj-remote";
/** Two distinct install-owner slots, exactly as upstream: the core bundle a
 * profile registers (this fork's package), and the separate npm CLI installer
 * artifact. Keeping them distinct is what makes ownership detection work. */
export declare const NATIVE_PLUGIN_PACKAGE = "dsh-lxj-remote-installer";
/** Upstream package ids. A profile that registers one of these together with
 * the fork is refused: the two artifacts share one node identity file
 * (~/.dsh/harness-remote/instances/<key>/identity.json), so both would enroll
 * the same nodeId and fight over the relay's single agent slot — the
 * enroll/evict storm this release fixes. */
export declare const FOREIGN_PLUGIN_PACKAGES: readonly ["@harness-remote/dsh-wechat-remote", "dsh-wechat-remote"];
export type WebInstallPackage = typeof PLUGIN_PACKAGE | typeof NATIVE_PLUGIN_PACKAGE;
export declare class ProfileOwnershipError extends Error {
    constructor(message: string);
}
/** A native bundle and the CLI payload are different package-manager owners,
 * even though they carry the same runtime. Never repair one by adding the other.
 * Inspect only the selected profile; another host's installation is irrelevant.
 * Unreferenced node_modules leftovers from a failed native add are not owners. */
export declare function webInstallOwner(profile: string): WebInstallPackage | undefined;
/** Legacy in-process update workers must still only replace their own core.
 * The external NPX installer instead selects the existing native package. */
export declare function assertCliInstallOwner(profile: string, activeRoot?: string): void;
export interface ProfileInstall {
    profile: string;
    directory: string;
    cli: string;
    targetVersion: string;
    runtime: InstallRuntime;
    packageName?: WebInstallPackage;
}
export declare function safeProfileName(value: string): boolean;
/** Copy without following links. Backups are restored to the SAME original path. */
export declare function backupProfile(profile: string, backup: string): void;
/** Private, per-operation PATH entry; never edit a global shim or shell profile. */
export declare function installToolPath(directory: string, runtime: InstallRuntime): string;
export declare class NativeInstallError extends Error {
    readonly mayStillBeRunning: boolean;
    constructor(message: string, mayStillBeRunning?: boolean);
}
export declare function runNativePlugin(cli: string, profile: string, home: string, toolPath: string, runtime: InstallRuntime, logFile: string, archiveName: string, timeoutMs?: number, operation?: 'add' | 'install'): Promise<void>;
/** The caller must stop the owning host and complete its backup first. */
export declare function installProfile(job: ProfileInstall): Promise<void>;
