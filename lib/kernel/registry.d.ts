/**
 * IEG kernel — module registry.
 *
 * Owns module registration and validation, enablement, dependency resolution,
 * and conflict detection, exactly as `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §5.1
 * requires. The kernel owns **no behavioural policy text**; that is the prompt
 * compiler's job (§5.2).
 */
/** Raised when a module violates the §6 module contract or the dependency graph. */
export declare class ModuleContractError extends Error {
    constructor(message: string);
}
/** The kernel module registry's public surface. */
export interface ModuleRegistry {
    registerModule(candidate: ModuleCandidate): GovernanceModule;
    getModule(id: string): GovernanceModule | undefined;
    listModules(): readonly GovernanceModule[];
    configure(toggles: Record<string, IegModuleToggle>): void;
    getEnabledModules(): readonly GovernanceModule[];
    isEnabled(id: string): boolean;
    diagnostics(): Record<string, unknown>;
}
/**
 * Create the kernel module registry.
 */
export declare function createRegistry(): ModuleRegistry;
