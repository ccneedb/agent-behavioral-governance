/**
 * ABG kernel — the npm-native plugin lifecycle (`ARCHITECTURE-SPEC` §28.6, 0.6.0).
 *
 * `abg install|update|uninstall` is the **one** implementation of the lifecycle.
 * `scripts/abg-npm.sh` is a thin wrapper over it, so there is no second copy of
 * the npm logic to drift.
 *
 * Why this exists at all: `dsh plugin --profile <p> add|remove ...` forwards its
 * arguments verbatim to **pnpm**, which the host hard-codes. A host that only has
 * npm cannot use that path. This module does the same job with npm and then
 * performs the one step `dsh plugin` does *outside* the package manager:
 * registering the package name in the profile manifest's `dsh.profile.bundles`
 * list, which is what makes DSH compose the `abg` row at boot.
 *
 * Design rules (carried over from the shell script it replaces):
 *
 *   - POSIX-hostile only in the sense that it needs `node`, `npm` and `dsh`;
 *     there are no runtime package dependencies.
 *   - Fails loudly: every step checks its result and reports a non-zero exit.
 *   - Idempotent: `install` twice is a no-op, `uninstall` on a clean profile is a
 *     no-op that still verifies absence.
 *   - Never writes to the live profile (`$HOME/.dsh`) unless explicitly told with
 *     `--allow-live` (or `ABG_NPM_ALLOW_LIVE=1`); `status` is read-only.
 *   - npm's cache defaults to a writable directory derived from the resolved
 *     `--home`, never the read-only `$HOME/.npm`.
 *
 * With no `--from`, `install`/`update` pack the repository's own `plugin/`
 * directory with `npm pack` — the canonical artifact producer — and copy the
 * resulting tarball into the profile first, so the recorded dependency is a
 * stable `file:.abg-artifacts/<name>.tgz` rather than a path back into the
 * source tree.
 *
 * Exit codes: 0 success · 1 verification/lifecycle failure · 2 usage/environment.
 */
/** The package this lifecycle manages. */
export declare const PACKAGE_NAME = "dsh-agent-behavioral-governance";
/** Where `npm install` records the artifact inside the profile. */
export declare const ARTIFACTS_DIR = ".abg-artifacts";
export type LifecycleAction = 'install' | 'update' | 'uninstall' | 'status';
export interface LifecycleOptions {
    action: LifecycleAction;
    profile: string;
    /** Resolved absolute `$DSH_HOME`. */
    home: string;
    /** Directory of this package (the `npm pack` source when `from` is empty). */
    pluginDir: string;
    /** `--from <tarball|url|dir>`. */
    from?: string;
    allowLive?: boolean;
    dryRun?: boolean;
    /** Accepted for non-interactive callers; the lifecycle never prompts. */
    yes?: boolean;
    env?: Record<string, string | undefined>;
    /** Override the profile template used to initialize a missing profile. */
    template?: string;
}
export interface LifecycleStep {
    command: string;
    args: string[];
    cwd?: string;
}
export interface LifecycleResult {
    ok: boolean;
    exitCode: number;
    action: LifecycleAction;
    profile: string;
    home: string;
    profileDir: string;
    npmCache: string;
    source: string;
    version: string;
    composed: string;
    messages: string[];
    error: string;
    steps: LifecycleStep[];
}
/** Names that could escape `<home>/profiles` and must never be accepted. */
export declare function validateProfileName(profile: string): string | undefined;
/** Trim trailing slashes without requiring the path to exist. */
export declare function normalizeHome(home: string): string;
/** The live `$HOME/.dsh`, which lifecycle writes must refuse by default. */
export declare function liveHome(env: Record<string, string | undefined>): string;
/**
 * npm's cache directory. An explicit `npm_config_cache` always wins; otherwise a
 * writable directory derived from the resolved home is used, because a restricted
 * `$HOME/.npm` fails every npm operation with EROFS before it starts.
 */
export declare function resolveNpmCache(home: string, env: Record<string, string | undefined>): string;
/**
 * Execute one lifecycle action. Pure description in `steps`; the side effects are
 * the npm/dsh invocations and the profile-manifest edits, exactly as the shell
 * script performed them.
 */
export declare function runLifecycle(options: LifecycleOptions): LifecycleResult;
