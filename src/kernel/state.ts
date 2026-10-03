/**
 * IEG kernel — per-agent governance state.
 *
 * The `0.1.0` prototype held every ledger once per composition, so two
 * concurrent agents shared one orientation, and a second session could satisfy
 * the first session's gate. That is a correctness
 * defect, not a cosmetic one (ARCHITECTURE-SPEC Part B §25, delta D15).
 *
 * The verified host fact behind the fix is §17.7: the per-agent scope key **is
 * the agent object itself**, and every seam IEG binds already carries that
 * object — `AssembleContext.agent` (merge-extended by `@deepseek-ai/dsh-agent`),
 * the `agent/pre-step` payload, `tools/pre-execute`'s `exec.agent`, and the
 * `tools/result` and `fs/*` actor.
 *
 * IEG therefore keys its live state by that object identity. Identity keying
 * gives the same isolation as a scope-keyed store, releases state with the agent
 * instead of leaking it, and preserves the package's zero-first-party-import
 * property: `ScopedLayers` would require importing `@deepseek-ai/dsh-scope`
 * (§25.3, assumption B3).
 */

import { createOrientationStore } from './orientation.js'

/**
 * The live agent id, when the subject carries one.
 *
 * The host's `Agent` exposes `id`; seams may hand IEG a subject that does not
 * (a bare assembly context, for example), and a missing id must never throw.
 */
export function agentIdOf(agent: unknown): string {
  const id = (agent as { id?: unknown } | null | undefined)?.id
  return typeof id === 'string' ? id : ''
}

/** One agent's governance state. */
interface AgentState {
  orientation: ReturnType<typeof createOrientationStore>
}

/**
 * One agent's governance state.
 */
export function createAgentState(): AgentState {
  return {
    orientation: createOrientationStore(),
  }
}

/** Live governance state, isolated per live agent. */
interface GovernanceState {
  forAgent: (agent: unknown) => AgentState
  unscoped: AgentState
}

/**
 * Live governance state, isolated per live agent.
 *
 * A seam may run without an agent — a global prompt assembly, for example.
 * Those calls share one unscoped bucket rather than creating unbounded state.
 */
export function createGovernanceState(): GovernanceState {
  const byAgent = new WeakMap<object, ReturnType<typeof createAgentState>>()
  const unscoped = createAgentState()

  /**
   * Resolve one agent's state, creating it on first use.
   */
  function forAgent(agent: unknown): ReturnType<typeof createAgentState> {
    if (agent === null || typeof agent !== 'object') return unscoped
    let state = byAgent.get(agent)
    if (state === undefined) {
      state = createAgentState()
      byAgent.set(agent, state)
    }
    return state
  }

  return { forAgent, unscoped }
}
