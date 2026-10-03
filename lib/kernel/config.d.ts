/**
 * IEG configuration resolution.
 *
 * Follows the DSH convention used by `dsh-plan-mode`'s `resolveConfig`: a plugin
 * may accept a plain object and validate it explicitly. IEG does this rather
 * than declaring a `static Config` schema so the package has **zero runtime
 * dependencies** and stays mountable in any composition.
 *
 * Validation is strict: unknown keys, blank strings, and wrong types fail at
 * plugin load instead of being silently ignored.
 */
/**
 * Tools whose call is treated as a persistent workspace mutation.
 *
 * **Shell tools are deliberately excluded.** Classifying `bash` or `pwsh` as a
 * mutation gates *every* shell command — including read-only ones such as `ls`,
 * `grep`, and `node --test` — because the gate sees only an opaque command
 * string. That blocks ordinary work, and under `policy: 'ask'` in a composition
 * with no approval channel it denies the agent its entire shell.
 *
 * The host already confines shell writes through its own sandbox
 * (`dsh-bash-sandbox` plus the `read-only` / `workspace-write` /
 * `danger-full-access` policy), so IEG governing them too would duplicate host
 * semantics, which PRODUCT-SPEC P1 forbids.
 *
 * IEG therefore governs *file-effect* mutations, where `(name, arguments)` is
 * unambiguous.
 */
export declare const DEFAULT_MUTATING_TOOLS: readonly string[];
/**
 * Default order for the single IEG prompt section. `ARCHITECTURE-SPEC` §17.2
 * verified that DSH exposes no plugin-allocatable placement, so the value is
 * explicit. It is exported because the configuration-fault path mounts the
 * status line at the same order when no validated configuration exists.
 */
export declare const DEFAULT_SECTION_ORDER = 8500;
/** Raised when a configuration value is missing, malformed, or unknown. */
export declare class IegConfigError extends Error {
    constructor(message: string);
}
/**
 * Validate and detach the raw patch-layer config.
 *
 * @param raw - the `config` block of the composition row.
 * @returns a frozen, fully populated configuration.
 */
export declare function resolveConfig(raw?: unknown): IegConfig;
