/**
 * IEG kernel — module registry.
 *
 * Owns module registration and validation, enablement, dependency resolution,
 * and conflict detection, exactly as `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §5.1
 * requires. The kernel owns **no behavioural policy text**; that is the prompt
 * compiler's job (§5.2).
 */
const RISK_LEVELS = ['low', 'medium', 'high'];
/** Raised when a module violates the §6 module contract or the dependency graph. */
export class ModuleContractError extends Error {
    constructor(message) {
        super(`ieg module contract: ${message}`);
        this.name = 'ModuleContractError';
    }
}
/**
 * @param value
 * @param path
 * @returns the validated non-empty string.
 */
function requireText(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ModuleContractError(`"${path}" must be a non-empty string`);
    }
    return value;
}
/**
 * Validate one untrusted module candidate against the §6 contract.
 *
 * @param candidate
 * @returns the validated, frozen module.
 */
function validateModule(candidate) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        throw new ModuleContractError('a module must be an object');
    }
    const module = {
        id: requireText(candidate.id, 'id'),
        version: requireText(candidate.version, 'version'),
        problem: requireText(candidate.problem, 'problem'),
        objective: requireText(candidate.objective, 'objective'),
        principles: (() => {
            const principles = candidate.principles;
            if (!Array.isArray(principles) || principles.length === 0) {
                throw new ModuleContractError(`"${String(candidate.id)}.principles" must be a non-empty array`);
            }
            return Object.freeze(principles.map((entry, index) => requireText(entry, `principles[${index}]`)));
        })(),
        prompt: candidate.prompt === undefined ? undefined : requireText(candidate.prompt, 'prompt'),
        dependencies: (() => {
            const dependencies = candidate.dependencies;
            if (dependencies === undefined)
                return Object.freeze([]);
            if (!Array.isArray(dependencies)) {
                throw new ModuleContractError(`"${String(candidate.id)}.dependencies" must be an array`);
            }
            return Object.freeze(dependencies.map((entry, index) => requireText(entry, `dependencies[${index}]`)));
        })(),
        risk: (() => {
            const risk = candidate.risk;
            if (typeof risk !== 'string' || !RISK_LEVELS.includes(risk)) {
                throw new ModuleContractError(`"${String(candidate.id)}.risk" must be one of ${RISK_LEVELS.join(' | ')}`);
            }
            return risk;
        })(),
        enabledByDefault: (() => {
            const value = candidate.enabledByDefault;
            if (typeof value !== 'boolean') {
                throw new ModuleContractError(`"${String(candidate.id)}.enabledByDefault" must be a boolean`);
            }
            return value;
        })(),
        addresses: (() => {
            const addresses = candidate.addresses;
            if (addresses === undefined)
                return Object.freeze([]);
            if (!Array.isArray(addresses)) {
                throw new ModuleContractError(`"${String(candidate.id)}.addresses" must be an array`);
            }
            return Object.freeze(addresses.map((entry, index) => requireText(entry, `addresses[${index}]`)));
        })(),
    };
    return Object.freeze(module);
}
/**
 * Create the kernel module registry.
 */
export function createRegistry() {
    const modules = new Map();
    const explicitlyDisabled = new Set();
    const autoEnabledForDependency = new Set();
    const conflicts = [];
    /**
     * @param candidate
     * @returns the registered module.
     */
    function registerModule(candidate) {
        const module = validateModule(candidate);
        if (modules.has(module.id)) {
            throw new ModuleContractError(`duplicate module id "${module.id}"`);
        }
        modules.set(module.id, module);
        return module;
    }
    /**
     * @param id
     * @returns the module, or `undefined` when no such id is registered.
     */
    function getModule(id) {
        return modules.get(id);
    }
    /**
     * @returns every registered module, in registration order.
     */
    function listModules() {
        return Object.freeze([...modules.values()]);
    }
    /**
     * Apply per-id enablement from configuration, then resolve the dependency
     * graph. Throws on an unknown id, a missing dependency, or a conflict between
     * an explicitly disabled module and an enabled dependent.
     *
     * @param toggles
     */
    function configure(toggles) {
        explicitlyDisabled.clear();
        autoEnabledForDependency.clear();
        conflicts.length = 0;
        for (const [id, toggle] of Object.entries(toggles)) {
            if (!modules.has(id))
                throw new ModuleContractError(`unknown module id "${id}" in configuration`);
            if (!toggle.enabled)
                explicitlyDisabled.add(id);
        }
        // Conflict detection: an enabled module must not depend on a disabled one.
        for (const module of modules.values()) {
            if (explicitlyDisabled.has(module.id))
                continue;
            for (const dependency of module.dependencies ?? []) {
                if (!modules.has(dependency)) {
                    throw new ModuleContractError(`module "${module.id}" depends on unknown module "${dependency}"`);
                }
                if (explicitlyDisabled.has(dependency)) {
                    conflicts.push(`${module.id} requires ${dependency}`);
                }
            }
        }
        if (conflicts.length > 0) {
            throw new ModuleContractError(`conflicting enablement: ${conflicts.join('; ')}`);
        }
        // Auto-enable transitive dependencies of any enabled module.
        const visit = (id) => {
            const module = modules.get(id);
            if (module === undefined)
                return;
            for (const dependency of module.dependencies ?? []) {
                if (explicitlyDisabled.has(dependency))
                    continue;
                if (!autoEnabledForDependency.has(dependency)) {
                    autoEnabledForDependency.add(dependency);
                    visit(dependency);
                }
            }
        };
        for (const module of modules.values()) {
            if (!explicitlyDisabled.has(module.id))
                visit(module.id);
        }
    }
    /**
     * @param id
     * @returns whether the module is enabled, by default or by dependency.
     */
    function isEnabled(id) {
        const module = modules.get(id);
        if (module === undefined)
            return false;
        if (explicitlyDisabled.has(id))
            return false;
        if (module.enabledByDefault)
            return true;
        return autoEnabledForDependency.has(id);
    }
    /**
     * Enabled modules in dependency order: every module appears after all of its
     * dependencies. Uses a deterministic topological sort (registration order as
     * the tie-break) and throws on a dependency cycle.
     *
     * @returns the enabled modules, dependencies first.
     */
    function getEnabledModules() {
        const ordered = [];
        const visiting = new Set();
        const visited = new Set();
        /**
         * @param id
         */
        const visit = (id) => {
            if (visited.has(id))
                return;
            if (visiting.has(id))
                throw new ModuleContractError(`dependency cycle detected at "${id}"`);
            const module = modules.get(id);
            if (module === undefined || !isEnabled(id))
                return;
            visiting.add(id);
            for (const dependency of module.dependencies ?? [])
                visit(dependency);
            visiting.delete(id);
            visited.add(id);
            ordered.push(module);
        };
        for (const module of modules.values())
            visit(module.id);
        return Object.freeze(ordered);
    }
    /**
     * A compact, machine-readable account of registration and enablement.
     *
     * @returns the diagnostics record.
     */
    function diagnostics() {
        const registered = [...modules.keys()];
        const enabled = getEnabledModules().map((module) => module.id);
        return {
            modules_registered: registered,
            modules_enabled: enabled,
            modules_disabled: registered.filter((id) => !enabled.includes(id)),
            modules_auto_enabled_for_dependency: [...autoEnabledForDependency].sort(),
            modules_conflicts: [...conflicts],
        };
    }
    return {
        registerModule,
        getModule,
        listModules,
        configure,
        getEnabledModules,
        isEnabled,
        diagnostics,
    };
}
