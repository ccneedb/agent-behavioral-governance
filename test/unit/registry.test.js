import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createRegistry, ModuleContractError } from '../../lib/kernel/registry.js'
import { projectGovernanceModule } from '../../lib/modules/project-governance.js'
import { informationIntegrityModule } from '../../lib/modules/information-integrity.js'
import { workspaceGovernanceModule } from '../../lib/modules/workspace-governance.js'
import { MODULES } from '../../lib/index.js'

/** @returns {ReturnType<typeof createRegistry>} */
function registryWithModules() {
  const registry = createRegistry()
  for (const module of MODULES) registry.registerModule(module)
  return registry
}

test('every shipped module satisfies the §6 contract', () => {
  const required = ['id', 'version', 'problem', 'objective', 'principles', 'risk', 'enabledByDefault']
  for (const module of MODULES) {
    for (const key of required) {
      assert.ok(key in module, `${module.id} is missing "${key}"`)
    }
    assert.ok(['low', 'medium', 'high'].includes(module.risk))
    assert.ok(module.principles.length > 0)
  }
  assert.deepEqual(
    MODULES.map((module) => module.id),
    [
      'project-governance',
      'information-integrity',
      'workspace-governance',
    ],
  )
})

test('registration rejects a duplicate id', () => {
  const registry = createRegistry()
  registry.registerModule(projectGovernanceModule)
  assert.throws(() => registry.registerModule(projectGovernanceModule), ModuleContractError)
})

test('registration rejects contract violations', () => {
  const registry = createRegistry()
  const valid = { ...projectGovernanceModule, id: 'x' }

  assert.throws(() => registry.registerModule({ ...valid, id: '' }), ModuleContractError)
  assert.throws(() => registry.registerModule({ ...valid, version: '' }), ModuleContractError)
  assert.throws(() => registry.registerModule({ ...valid, problem: '' }), ModuleContractError)
  assert.throws(() => registry.registerModule({ ...valid, objective: '' }), ModuleContractError)
  assert.throws(() => registry.registerModule({ ...valid, principles: [] }), ModuleContractError)
  assert.throws(() => registry.registerModule({ ...valid, principles: 'x' }), ModuleContractError)
  assert.throws(() => registry.registerModule({ ...valid, risk: 'extreme' }), ModuleContractError)
  assert.throws(() => registry.registerModule({ ...valid, enabledByDefault: 'yes' }), ModuleContractError)
  assert.throws(() => registry.registerModule(null), ModuleContractError)
})

test('configure rejects an unknown module id', () => {
  const registry = registryWithModules()
  assert.throws(() => registry.configure({ 'not-a-module': { enabled: false } }), ModuleContractError)
})

test('enabled modules are returned in dependency order', () => {
  const registry = registryWithModules()
  registry.configure({})
  const order = registry.getEnabledModules().map((module) => module.id)

  const indexOf = (id) => order.indexOf(id)
  // workspace-governance depends on project-governance and information-integrity.
  assert.ok(indexOf('project-governance') < indexOf('information-integrity'))
  assert.ok(indexOf('information-integrity') < indexOf('workspace-governance'))
  assert.equal(order.length, 3)
})

test('disabling a module removes it and everything is still ordered', () => {
  const registry = registryWithModules()
  registry.configure({ 'workspace-governance': { enabled: false } })
  const order = registry.getEnabledModules().map((module) => module.id)
  assert.ok(!order.includes('workspace-governance'))
  assert.equal(order.length, 2)
})

test('disabling a required dependency is reported as a conflict', () => {
  const registry = registryWithModules()
  // workspace-governance requires project-governance; disabling the dependency
  // while the dependent stays enabled is a configuration conflict.
  assert.throws(
    () => registry.configure({ 'information-integrity': { enabled: false } }),
    ModuleContractError,
  )
})

test('a dependency cycle is detected', () => {
  const registry = createRegistry()
  const base = { version: '1', problem: 'p', objective: 'o', principles: ['x'], risk: 'low', enabledByDefault: true }
  registry.registerModule({ ...base, id: 'a', dependencies: ['b'] })
  registry.registerModule({ ...base, id: 'b', dependencies: ['a'] })
  registry.configure({})
  assert.throws(() => registry.getEnabledModules(), ModuleContractError)
})

test('an unknown dependency is rejected', () => {
  const registry = createRegistry()
  registry.registerModule({
    id: 'a',
    version: '1',
    problem: 'p',
    objective: 'o',
    principles: ['x'],
    risk: 'low',
    enabledByDefault: true,
    dependencies: ['ghost'],
  })
  assert.throws(() => registry.configure({}), ModuleContractError)
})

test('a disabled-by-default dependency is auto-enabled for its dependent', () => {
  const registry = createRegistry()
  const base = { version: '1', problem: 'p', objective: 'o', principles: ['x'], risk: 'low' }
  registry.registerModule({ ...base, id: 'leaf', enabledByDefault: true, dependencies: ['optional-dep'] })
  registry.registerModule({ ...base, id: 'optional-dep', enabledByDefault: false })
  registry.configure({})

  const order = registry.getEnabledModules().map((module) => module.id)
  assert.deepEqual(order, ['optional-dep', 'leaf'])
  assert.deepEqual(registry.diagnostics().modules_auto_enabled_for_dependency, ['optional-dep'])
})

test('the shipped dependency graph is exactly as documented', () => {
  assert.deepEqual(projectGovernanceModule.dependencies, [])
  assert.deepEqual(informationIntegrityModule.dependencies, ['project-governance'])
  assert.deepEqual(workspaceGovernanceModule.dependencies, ['project-governance', 'information-integrity'])
})
