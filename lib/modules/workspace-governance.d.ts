/**
 * Module: `workspace-governance` (M4).
 *
 * **Problem:** unauthorized persistent workspace mutation.
 * **Objective:** make workspace structure an explicitly governed part of project state.
 *
 * Verified host facts that shape this module (`ARCHITECTURE-SPEC` §17.3, §17.4):
 *
 * - `tools/pre-execute` is the only pre-execution, scope-isolated view of a call,
 *   and it exposes `(name, arguments)` but **cannot rewrite** arguments.
 * - Returning `{ kind: 'ask' }` makes the tool registry resolve the human prompt
 *   through `ctx.approval`, inheriting its fail-closed path. IEG must not
 *   reimplement approval.
 * - `ctx.tools.guard()` is monotonic and deny-only, so it is the correct
 *   backstop for a rule that listener ordering must not be able to defeat.
 * - IEG must never compute filesystem containment; `ctx.sandboxPolicy` owns it.
 *
 * Boundary: this is **tool-mediated** mutation governance. A plugin calling
 * `ctx.fs.writeText()` directly dispatches no `fs/*` events and bypasses
 * `tools/*`; IEG does not claim process-wide write coverage.
 */
export interface MutationClassification {
    kind: 'read-only' | 'persistent-mutation';
    tool: string;
    targets: string[];
    protected: boolean;
}
/** Shell tools, whose command text is inspected to decide whether they mutate. */
export declare const SHELL_TOOLS: readonly string[];
/**
 * Whether a shell command can create, overwrite, or remove a file.
 *
 * IEG excludes shell tools from `mutatingTools` and inspects the command text
 * instead, because gating every shell call would block `ls`, `grep`, and
 * `node --test`. The cost of that exclusion was a coverage hole: a document can
 * be created with a shell redirection rather than the `write` tool, bypassing
 * the overlap gate entirely. This closes that hole without opening one in the
 * other direction: quoted text is data unless the command wraps another command,
 * so `rg '=>' src` is not mistaken for a write.
 *
 * Two residual limits are measured by `test/unit/shell-classification.test.js`
 * rather than hidden: a wrapper invoked indirectly (`env bash -c '…'`) is
 * treated as data, and a PowerShell `Remove-Item` is not recognised as a write.
 */
export declare function commandWritesFiles(command: unknown): boolean;
/**
 * Extract the persistent targets a call names, if any.
 */
export declare function extractTargets(toolName: string, args: unknown): string[];
/**
 * Whether a target is inside the protected set. A protected entry matches the
 * target itself or any path beneath it.
 */
export declare function isProtectedPath(target: string, protectedPaths: readonly string[]): boolean;
/**
 * Classify a tool call as read-only inspection or persistent mutation.
 *
 * A shell call is a mutation when its command can write to the filesystem, so
 * the hole left by excluding shell tools from `mutatingTools` is closed without
 * gating ordinary read-only shell work.
 */
export declare function classifyMutation(toolName: string, args: unknown, policy: {
    mutatingTools: readonly string[];
    protectedPaths: readonly string[];
    classifyShellCommands?: boolean;
}): MutationClassification;
/**
 * Decide the pre-execution outcome for a classified call.
 *
 * Precedence: a protected target is refused outright, then the configured
 * policy applies. `ask` delegates to the host approval service; IEG never
 * fabricates authorization (P1, §13).
 */
export declare function decideMutation(classification: MutationClassification, config: {
    policy: 'allow' | 'ask' | 'deny';
    protectedPaths: readonly string[];
}): {
    kind: 'allow';
} | {
    kind: 'ask';
    reason: string;
} | {
    kind: 'deny';
    reason: string;
};
/**
 * The monotonic guard backstop. Runs after every `tools/pre-execute` listener,
 * so a later allow cannot reinstate a denied call. Deny-only and synchronous.
 */
export declare function guardBackstop(execution: IegToolExecution, policy: {
    mutatingTools: readonly string[];
    protectedPaths: readonly string[];
}): string | undefined;
/** The §6 module descriptor. */
export declare const workspaceGovernanceModule: Readonly<{
    id: "workspace-governance";
    version: "0.2.0";
    problem: "unauthorized persistent workspace mutation";
    objective: "make workspace structure an explicitly governed part of project state";
    principles: readonly string[];
    prompt: "Inspect freely. A persistent mutation may be routed to the user for approval, and each approval covers only that one change; a previous approval or an existing convention is not standing authorization.";
    dependencies: readonly string[];
    risk: "high";
    enabledByDefault: true;
    addresses: readonly string[];
}>;
