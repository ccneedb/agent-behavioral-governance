/**
 * IEG kernel — document-overlap detection.
 *
 * Acceptance objective OBJ-2 asks that, before creating a file, the agent
 * determine whether the new file "highly overlaps in functional positioning and
 * main content with existing files". Prompt guidance alone cannot make that
 * reliable, so this module supplies the deterministic check that the
 * `tools/pre-execute` gate can apply.
 *
 * Design constraints:
 *
 * - **Bounded.** It reads at most `MAX_DOCUMENTS` nearby documents, each capped
 *   at `MAX_BYTES`, and only document-like extensions.
 * - **Fail-open.** A heuristic governance check must never block work because a
 *   read failed. Every error path returns "no overlap".
 * - **Dependency-free.** No imports, including Node builtins; the plugin stays
 *   import-free so it mounts in any composition.
 */
/** How the overlap check behaves when it fires. */
export const OVERLAP_MODES = Object.freeze(['off', 'ask', 'deny']);
/** Word-set Jaccard at or above this counts as substantially overlapping. */
export const DEFAULT_OVERLAP_THRESHOLD = 0.4;
/**
 * Fraction of a new document's filename subject that an existing document's
 * headings must already cover for it to count as a duplicate subject. Body
 * similarity alone misses a rewrite of an already-documented topic.
 */
export const DEFAULT_SUBJECT_THRESHOLD = 0.5;
const DOCUMENT_EXTENSIONS = /\.(md|markdown|mdx|txt|rst|adoc)$/i;
const MAX_DOCUMENTS = 25;
const MAX_BYTES = 128 * 1024;
const MIN_TOKEN = 4;
/**
 * The token set of a text.
 *
 * @param text
 * @returns the tokens.
 */
export function tokensOf(text) {
    return new Set(text
        .toLowerCase()
        .split(/[^a-z0-9/_.-]+/)
        .filter((word) => word.length >= MIN_TOKEN));
}
/**
 * @param a
 * @param b
 * @returns Jaccard similarity, 0 when either side is empty.
 */
export function jaccard(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let intersection = 0;
    for (const token of a)
        if (b.has(token))
            intersection += 1;
    return intersection / (a.size + b.size - intersection);
}
/**
 * The first Markdown H1, used as a cheap "same document, different file" signal.
 *
 * @param text
 * @returns the lower-cased H1, or `null` when there is none.
 */
export function firstHeading(text) {
    const match = text.match(/^#\s+(.+)$/m);
    return match === null ? null : match[1].trim().toLowerCase();
}
/**
 * Every Markdown heading in a document, at any level, lower-cased.
 *
 * @param text
 * @returns the headings.
 */
export function headingsOf(text) {
    return [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim().toLowerCase());
}
/**
 * The tokens a filename claims as its subject, e.g. `AUTHENTICATION.md` ->
 * `{ authentication }`.
 *
 * @param target
 * @returns the filename stem tokens.
 */
export function filenameStemTokens(target) {
    const basename = target.replace(/\\/g, '/').split('/').pop() ?? '';
    return tokensOf(basename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
}
/**
 * Whether two tokens denote the same subject.
 *
 * Prefix variants of one word must match, because a document named after its
 * subject often uses the short form. The end-to-end evaluation produced an
 * `AUTH.md` duplicating a `## Authentication` section, and under exact matching
 * that file scored **no** subject overlap at all — the gate let it through.
 * "spec"/"specification" behaves the same way.
 *
 * @param a
 * @param b
 * @returns whether the two tokens denote the same subject.
 */
function sameSubjectToken(a, b) {
    if (a === b)
        return true;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    return shorter.length >= MIN_TOKEN && longer.startsWith(shorter);
}
/**
 * How much of a proposed document's filename subject an existing document
 * already covers, via its own filename, H1, or any section heading.
 *
 * This catches the failure that body-similarity misses: a new document that
 * re-states a topic for which the existing document already has a section, in
 * entirely different words. Measured on the evaluation sandboxes, a duplicate
 * `AUTHENTICATION.md` scored only 0.14 body similarity against a `SPEC.md` that
 * already carried an `## Authentication` section.
 *
 * @param stemTokens
 * @param document
 * @returns fraction of `stemTokens` covered, 0 when there are none.
 */
export function subjectCoverage(stemTokens, document) {
    if (stemTokens.size === 0)
        return 0;
    const pool = new Set(filenameStemTokens(document.path));
    for (const heading of [...headingsOf(document.content), firstHeading(document.content) ?? '']) {
        for (const token of tokensOf(heading))
            pool.add(token);
    }
    let covered = 0;
    for (const token of stemTokens) {
        for (const candidate of pool) {
            if (sameSubjectToken(token, candidate)) {
                covered += 1;
                break;
            }
        }
    }
    return covered / stemTokens.size;
}
/**
 * Compare a proposed document against existing ones.
 *
 * Three independent signals count as an overlap:
 *
 * 1. `similarity` — body word-set Jaccard at or above the threshold.
 * 2. `same_title` — the proposed H1 equals an existing document's H1.
 * 3. `subject` — the proposed *filename* names a topic the existing document
 *    already has a heading (or filename) for, however differently it is worded.
 *
 * @param input
 * @returns the overlap verdict and its per-document basis.
 */
export function detectOverlap(input) {
    const threshold = input.threshold ?? DEFAULT_OVERLAP_THRESHOLD;
    const subjectThreshold = input.subjectThreshold ?? DEFAULT_SUBJECT_THRESHOLD;
    const proposedTokens = tokensOf(input.content);
    const proposedTitle = firstHeading(input.content);
    const stemTokens = input.path === undefined ? new Set() : filenameStemTokens(input.path);
    const details = [];
    let best = 0;
    let bestPath = null;
    for (const document of input.existing) {
        const similarity = jaccard(proposedTokens, tokensOf(document.content));
        const sameTitle = proposedTitle !== null && proposedTitle === firstHeading(document.content);
        const coverage = subjectCoverage(stemTokens, document);
        const subject = stemTokens.size > 0 && coverage >= subjectThreshold && jaccard(stemTokens, filenameStemTokens(document.path)) < 1;
        if (similarity > best) {
            best = similarity;
            bestPath = document.path;
        }
        if (similarity >= threshold || sameTitle || subject) {
            details.push({ path: document.path, similarity: Number(similarity.toFixed(3)), same_title: sameTitle, subject });
        }
    }
    return {
        overlapping: details.length > 0,
        with: details[0]?.path ?? bestPath,
        similarity: Number(best.toFixed(3)),
        same_title: details.some((entry) => entry.same_title),
        subject: details.some((entry) => entry.subject),
        details,
    };
}
/**
 * Split a path into its directory, keeping the operation dependency-free.
 *
 * @param target
 * @returns the directory part of the path.
 */
function directoryOf(target) {
    const normalised = target.replace(/\\/g, '/');
    const index = normalised.lastIndexOf('/');
    if (index < 0)
        return '.';
    if (index === 0)
        return '/';
    return normalised.slice(0, index);
}
/**
 * Extract a full-document write from a tool call, if it is one.
 *
 * Only calls that supply a complete body are considered: a partial `edit` has no
 * meaningful content to compare, so it is skipped rather than guessed at.
 *
 * @param execution
 * @returns the proposed document, or `null` when the call is not a full write.
 */
export function extractDocumentWrite(execution) {
    if (typeof execution.arguments !== 'object' || execution.arguments === null)
        return null;
    const args = execution.arguments;
    const rawPath = args.file_path ?? args.path ?? args.target;
    const content = args.content;
    if (typeof rawPath !== 'string' || rawPath.trim() === '')
        return null;
    if (typeof content !== 'string' || content.trim() === '')
        return null;
    if (!DOCUMENT_EXTENSIONS.test(rawPath))
        return null;
    return { path: rawPath, content };
}
/**
 * Read the document-like files in the directory containing the target.
 *
 * @param fs
 * @param targetPath
 * @param options
 * @returns the documents found, and whether the scan stopped early.
 */
export async function scanNearbyDocuments(fs, targetPath, options = {}) {
    const maxDocuments = options.maxDocuments ?? MAX_DOCUMENTS;
    const maxBytes = options.maxBytes ?? MAX_BYTES;
    const documents = [];
    let truncated = false;
    const directory = directoryOf(targetPath);
    const dirTarget = await fs.resolve(directory);
    const entries = await fs.listDir(dirTarget);
    for (const entry of entries) {
        if (entry.type !== 'file')
            continue;
        if (!DOCUMENT_EXTENSIONS.test(entry.name))
            continue;
        if (entry.size !== undefined && entry.size > maxBytes)
            continue;
        if (documents.length >= maxDocuments) {
            truncated = true;
            break;
        }
        try {
            const content = await fs.readText(entry.target);
            documents.push({ path: entry.name, content });
        }
        catch {
            // Unreadable candidate: skip it rather than failing the whole check.
        }
    }
    return { documents, truncated };
}
/**
 * The gate entry point: decide whether a proposed new document duplicates an
 * existing one.
 *
 * Only *creations* are checked. Overwriting a file the agent already inspected
 * is the normal, desirable path and must not be obstructed.
 *
 * @param input
 * @returns the gate decision, or `null` when there is no overlap.
 */
export async function checkDocumentOverlap(input) {
    if (input.mode === 'off')
        return null;
    if (input.fs === undefined)
        return null;
    // Fail-open: this is a heuristic guard, never a reason to break a call.
    try {
        const proposed = extractDocumentWrite(input.execution);
        if (proposed === null)
            return null;
        const target = await input.fs.resolve(proposed.path);
        const existing = await input.fs.stat(target);
        if (existing !== undefined)
            return null; // an overwrite, not a creation
        const { documents } = await scanNearbyDocuments(input.fs, proposed.path);
        if (documents.length === 0)
            return null;
        const overlap = detectOverlap({
            path: proposed.path,
            content: proposed.content,
            existing: documents,
            ...(input.threshold === undefined ? {} : { threshold: input.threshold }),
        });
        if (!overlap.overlapping)
            return null;
        const named = overlap.details
            .map((entry) => {
            const basis = entry.subject ? 'same subject' : `${Math.round(entry.similarity * 100)}% overlap`;
            return `${entry.path} (${basis})`;
        })
            .join(', ');
        const reason = `ieg: "${proposed.path}" substantially duplicates existing documentation: ${named}. ` +
            'Extend the existing document instead of creating a near-duplicate, or state why a separate document is warranted.';
        return { kind: input.mode, reason };
    }
    catch {
        return null;
    }
}
