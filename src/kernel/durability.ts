/**
 * IEG kernel — durable governance state (handoff Gate F).
 *
 * Without this, every ledger lives only inside `apply()`: a resumed, forked, or
 * restarted session began with no memory of its orientation, so with
 * `requireBeforeMutation: true` the agent's first write after a resume was
 * refused again until it re-recorded orientation.
 *
 * **Why there is no schema-library import.** `domainTable(schema)` is a one-line
 * wrapper, and the host reads a stored record through exactly one call:
 * `tableSpec.valueSchema.parse(raw)`. So the plugin supplies its own object with
 * a real `parse` that validates the shape, and keeps the property that every
 * import in this package is a relative one. IEG validates its own records; it
 * does not need the host's schema library to do it.
 *
 * Everything here **fails open**. If the storage facility is absent, opening
 * fails, or a record is corrupt, IEG behaves exactly as it did before this
 * module existed: no persistence, no error, and governance still enforces.
 */

/** Domain name, doubling as the backend unit name. */
export const DOMAIN_NAME = 'ieg_governance'

/**
 * Current domain format version. Domains have **no migration facility** — a
 * stored version mismatch rejects at open — so this must only change alongside a
 * deliberate migration decision.
 */
export const DOMAIN_VERSION = 1

/** Table holding one record per session. */
export const TABLE_NAME = 'sessions'

/**
 * The minimal schema the host requires for a table value: it wraps the record in
 * a JSON payload so the stored shape never has to track the in-memory shape.
 */
export interface IegRecordSchema {
  parse(value: unknown): { payload: string }
}

/**
 * The minimal schema the host requires for a table value.
 *
 * @returns the value schema used for every stored session record.
 */
export function createRecordSchema(): IegRecordSchema {
  return {
    /**
     * @param value
     * @returns the validated `{ payload }` record.
     */
    parse(value: unknown) {
      if (typeof value !== 'object' || value === null) {
        throw new Error('ieg: stored governance record must be an object')
      }
      const payload = (value as { payload?: unknown }).payload
      if (typeof payload !== 'string') {
        throw new Error('ieg: stored governance record must carry a string payload')
      }
      return { payload }
    },
  }
}

/** One table of an open host storage domain, narrowed to the durable store's use. */
interface StorageTable {
  get(id: string): { payload: string } | undefined
  put(id: string, value: { payload: string }): unknown
}

/** An open host storage domain. */
interface StorageDomain {
  table(name: string): StorageTable
  /** Present when the backend supports explicit release. */
  close?(): unknown
}

/** The `storageDomain` host service, as far as the durable store depends on it. */
interface StorageDomainFacility {
  open(options: {
    name: string
    version: number
    layout: 'per-record'
    tables: Record<string, { valueSchema: IegRecordSchema }>
  }): StorageDomain | Promise<StorageDomain>
}

/** The durable governance store's public surface. */
export interface DurableStore {
  available(): Promise<boolean>
  load(sessionId: string): Promise<Record<string, unknown> | undefined>
  save(sessionId: string, snapshot: Record<string, unknown>): Promise<boolean>
  close(): Promise<void>
}

/**
 * Create the durable store.
 *
 * @param ctx
 * @param options
 * @returns the durable store.
 */
export function createDurableStore(
  ctx: IegContext,
  options: { onError?: (error: unknown) => void } = {},
): DurableStore {
  let domain: StorageDomain | null = null
  let unavailable = false
  let opened = false

  /**
   * Open the domain once, lazily, and remember failure so it is not retried on
   * every call.
   *
   * @returns the open domain, or `null` when storage is unavailable.
   */
  async function open(): Promise<StorageDomain | null> {
    if (opened) return domain
    opened = true
    try {
      const facility = ctx.get?.('storageDomain') as StorageDomainFacility | undefined
      if (facility === undefined || typeof facility.open !== 'function') {
        unavailable = true
        return null
      }
      domain = await facility.open({
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        layout: 'per-record',
        tables: { [TABLE_NAME]: { valueSchema: createRecordSchema() } },
      })
      return domain
    } catch (error) {
      // A version mismatch, a missing backend, or a corrupt store must degrade to
      // "no persistence" rather than breaking every governed call.
      unavailable = true
      options.onError?.(error)
      return null
    }
  }

  return {
    available: async () => (await open()) !== null,

    /**
     * @param sessionId
     * @returns the stored snapshot, or `undefined` when none is available.
     */
    async load(sessionId: string): Promise<Record<string, unknown> | undefined> {
      const handle = await open()
      if (handle === null || sessionId === '') return undefined
      try {
        const record = handle.table(TABLE_NAME).get(sessionId)
        if (record === undefined) return undefined
        const parsed = JSON.parse(record.payload)
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
      } catch (error) {
        options.onError?.(error)
        return undefined
      }
    },

    /**
     * @param sessionId
     * @param snapshot
     * @returns whether the snapshot was stored.
     */
    async save(sessionId: string, snapshot: Record<string, unknown>): Promise<boolean> {
      const handle = await open()
      if (handle === null || sessionId === '') return false
      try {
        await handle.table(TABLE_NAME).put(sessionId, { payload: JSON.stringify(snapshot) })
        return true
      } catch (error) {
        options.onError?.(error)
        return false
      }
    },

    /** Release the handle when the plugin unloads. */
    async close(): Promise<void> {
      if (domain !== null && typeof domain.close === 'function') {
        try {
          await domain.close()
        } catch {
          /* teardown is best-effort */
        }
      }
      domain = null
      opened = false
      void unavailable
    },
  }
}

/**
 * The session id an execution belongs to, when one is identifiable.
 *
 * @param agent
 * @returns the session id, or `''` when none is identifiable.
 */
export function sessionIdOf(agent: unknown): string {
  const id = (agent as { session?: { id?: unknown } } | null | undefined)?.session?.id
  return typeof id === 'string' ? id : ''
}
