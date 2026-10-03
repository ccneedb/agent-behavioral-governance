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
export declare const DOMAIN_NAME = "ieg_governance";
/**
 * Current domain format version. Domains have **no migration facility** — a
 * stored version mismatch rejects at open — so this must only change alongside a
 * deliberate migration decision.
 */
export declare const DOMAIN_VERSION = 1;
/** Table holding one record per session. */
export declare const TABLE_NAME = "sessions";
/**
 * The minimal schema the host requires for a table value: it wraps the record in
 * a JSON payload so the stored shape never has to track the in-memory shape.
 */
export interface IegRecordSchema {
    parse(value: unknown): {
        payload: string;
    };
}
/**
 * The minimal schema the host requires for a table value.
 *
 * @returns the value schema used for every stored session record.
 */
export declare function createRecordSchema(): IegRecordSchema;
/** The durable governance store's public surface. */
export interface DurableStore {
    available(): Promise<boolean>;
    load(sessionId: string): Promise<Record<string, unknown> | undefined>;
    save(sessionId: string, snapshot: Record<string, unknown>): Promise<boolean>;
    close(): Promise<void>;
}
/**
 * Create the durable store.
 *
 * @param ctx
 * @param options
 * @returns the durable store.
 */
export declare function createDurableStore(ctx: IegContext, options?: {
    onError?: (error: unknown) => void;
}): DurableStore;
/**
 * The session id an execution belongs to, when one is identifiable.
 *
 * @param agent
 * @returns the session id, or `''` when none is identifiable.
 */
export declare function sessionIdOf(agent: unknown): string;
