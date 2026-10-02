/**
 * ABG — the `abg` terminal interface (`ARCHITECTURE-SPEC` §28.6, 0.6.0).
 *
 * One program, two modes:
 *
 * ```text
 * abg                -> the ANSI numbered menu (no dependencies, usable over SSH)
 * abg <command>      -> the same commands non-interactively, with flags, for CI
 * ```
 *
 * Every command is implemented once and both modes call it, so the menu cannot
 * drift from the flag surface. Arg parsing, ANSI rendering and `$EDITOR`
 * invocation are all hand-rolled over Node builtins: the package ships with
 * **zero runtime dependencies**.
 *
 * Exit codes: 0 success · 1 refused/failed · 2 usage or environment error
 * (including the refusal to touch the live `$HOME/.dsh` without `--allow-live`).
 */
/** Program entry. Returns the process exit code; never throws. */
export declare function main(argv: string[]): Promise<number>;
