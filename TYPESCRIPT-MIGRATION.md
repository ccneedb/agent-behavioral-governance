---
doc_type: migration-record
project: information-environment-governance
version: 1.0.0
plugin_version: 0.8.0
status: active
owner: maintainers
last_reviewed: 2026-10-03
revision: 0.8.0-batch-2
audience: contributors
language: en
---

# TypeScript migration — decision, build model, and exceptions

**Status: COMPLETE.** The decision was made and the first slice migrated on
2026-10-02; the runtime finished migrating in the `0.8.0` packaging round. Today
`src/**/*.ts` is the source of truth for the whole runtime and `lib/**` is its
`tsc` build output.
Owner: `src/**`, `test/**`, `tsconfig*.json`, `bin/ieg`, `lib/**`.
This file is the durable record the source-of-truth policy points at: **all
source is TypeScript; JavaScript survives only as a build artifact or as an entry
on the exception list in §4.**

> **Classification.** §1 (the decision and its evidence) is **CURRENT**: the
> environment facts it records still hold. §5 and §6 are **HISTORICAL** — they
> record the migration plan that has since been executed, and the runner
> limitation that once blocked test migration. Nothing in §5 or §6 is pending
> work.

## 1. Decision

**Empirical finding: `.ts` sources cannot be shipped and executed directly in
this environment. Design (B) is adopted: `.ts` sources plus `tsc`-emitted
JavaScript (and declarations) as the shipped build artifact.** Design (A)
("ship `.ts` and let Node strip types") is impossible here for three independent
reasons, each verified below.

### 1.1 Evidence — Node cannot execute TypeScript at all

This environment's Node is **built without TypeScript support**. The built-in
type stripping that is normally on by default is compiled out, and both explicit
flags fail. Raw commands and output:

```console
$ node --version
v24.21.0

$ node -p "JSON.stringify(process.features.typescript)"
false

$ node -p "JSON.stringify(process.config.variables.node_use_amaro)"
false

$ node .tsprobe/main.ts                 # default type stripping
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for /…/.tsprobe/main.ts

$ node --experimental-strip-types .tsprobe/main.ts
Error [ERR_NO_TYPESCRIPT]: Node.js is not compiled with TypeScript support
    at assertTypeScript (node:internal/util:247:11)
    at node:internal/modules/typescript:46:3

$ node --experimental-transform-types .tsprobe/main.ts
Error [ERR_NO_TYPESCRIPT]: Node.js is not compiled with TypeScript support
```

`ERR_NO_TYPESCRIPT` is raised from `node:internal/modules/typescript`, i.e. the
script is recognised as TypeScript and the runtime refuses it. This is not a
flag problem: `process.config.variables.node_use_amaro === false` is the compile
flag. (A plain `.js` file executes normally, so the runtime itself is sound.)

### 1.2 Evidence — Node refuses TypeScript inside `node_modules` regardless

An installed DSH plugin lives under a profile's `node_modules`. Node's own
documentation is explicit:

> To discourage package authors from publishing packages written in TypeScript,
> Node.js refuses to handle TypeScript files inside folders under a `node_modules`
> path.
> — <https://nodejs.org/api/typescript.html#type-stripping-in-dependencies>

So even on a Node build where stripping is enabled, a published package could not
ship `.ts` as its runtime entry. The same page states the intended model: "You
won't need [`noEmit`] if you intend to distribute `*.js` files."

### 1.3 Evidence — DSH's loader expects the compiled artifact

The host loads a plugin entry with the Cordis loader's dynamic `import()`, and its
relative-import rewriter maps **`.ts` → `.js`** — the host is written to load the
emitted JavaScript of a TypeScript-authored package:

```console
$ sed -n '214,226p' /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js
	import(name, getOuterStack) {
		if (name.startsWith("cordis:")) return this.ctx.loader.builtins[name.slice(7)];
		return composeError(async (info) => {
			info.offset += 3;
			if (this.ctx.loader.internal) return await this.ctx.loader.internal.import(name, this.ctx.baseUrl, {});
			else if (name.startsWith(".")) return await import(__rewriteRelativeImportExtension(
				new URL(name, this.ctx.baseUrl).href
			));
			else return await import(__rewriteRelativeImportExtension(name));
		}, getOuterStack);
	}

$ sed -n '119,124p' …/cordis-plugin-loader/lib/index.js
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? … : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
```

IEG is registered by **bare package name** (`name: dsh-information-environment-governance`
in `cordis.patch.yml`), so the rewriter leaves the specifier alone and Node's
`exports.` / `main` decides the file — `lib/index.js`. The rewriter's
`.ts`→`.js` mapping shows the intended authoring shape: TS in, JS out.

### 1.4 Consequences adopted

- `main` and `exports` stay exactly as before: `lib/index.js`. No public entry
  point is renamed.
- Sources are authored under `src/**`; `tsc` emits `lib/**`,
  which is what the running plugin imports.
- Zero runtime dependencies remain: the emitted JavaScript imports only relative
  paths and `node:` builtins, and the host seam is still the ambient
  `lib/contract.d.ts`. No third-party package is imported at runtime.
- `typescript` is declared in `devDependencies` (`^5.8.0 || ^6.0.0`); it is a
  build-time tool only and is never imported by the package. Nothing in
  `npm test` or `scripts/verify.sh` installs it or needs the network — the verified
  compiler here is the preinstalled global `tsc` **6.0.3** (`/usr/bin/tsc`).
  The npm registry was unreachable from this sandbox (`npm view` fails with
  `EROFS: read-only file system` on `~/.npm/_cacache`), so the dependency is
  declared but not installed, and `node_modules` is not committed.

## 2. Build model (CURRENT)

| Path | Role |
|---|---|
| `src/**/*.ts` | **Source of truth.** Every runtime module lives here; import specifiers use the emitted `.js` extension (NodeNext), exactly as the JavaScript did. |
| `lib/**/*.js` | **Build artifact** of `src/**/*.ts` (`tsc -p tsconfig.build.json`). Committed, never edited by hand; it is what `lib/index.js` and the tests import. |
| `lib/**/*.d.ts` | Build artifact of the same compile (`declaration: true`), not loaded at runtime. |
| `bin/ieg` | Permanent exception — see §4.1. |
| `lib/contract.d.ts` | Permanent exception — see §4.1. |
| `lib/compatibility-baseline.json` | Committed **data**, not source — see §4.1. |

`tsconfig.build.json` sets `rootDir: src` and `outDir: lib`, so the emitted tree
mirrors the source tree one-for-one. There is no `lib/generated/`: that output
directory is **RETIRED**, removed in `0.8.0`, and the structural regression
(`test/integration/packaging.test.js`) asserts it cannot return.

Rebuild after any `src/` edit:

```bash
npx tsc -p tsconfig.build.json     # or: npm run build
```

`npm test` runs `npm run build` first through its `pretest` hook, and
`scripts/verify.sh` runs the build as step 1, so a fresh checkout cannot test
stale output.

### 2.1 The `files:` vs `include` subtlety for the ambient contract

`tsconfig.build.json` has `rootDir: src` and `outDir: lib`, and its program is
described by:

```jsonc
"files":   ["lib/contract.d.ts"],   // an unconditional allowlist entry
"include": ["src/**/*.ts"]
```

The one hand-authored declaration file, `lib/contract.d.ts`, must be in the build
program, but it lives in `lib/` — the build's own `outDir`. **TypeScript
automatically excludes a program's `outDir` from that program**, and an `include`
entry does not protect a file from that automatic exclusion. Naming it in
`files` is an unconditional allowlist, so the ambient host types stay in the
program while `lib/**` remains build output. For the same reason,
`tsconfig.json` (the `npm run typecheck` project, which has no `outDir`) lists
`"include": ["src", "lib/contract.d.ts"]` and deliberately carries **no
`exclude`**: an overlapping `exclude` would silently drop the contract, and
`test/integration/packaging.test.js` asserts `lib/contract.d.ts` exists and that
every built module has a TypeScript source.

### 2.2 Why the compiled output is committed (`files` allowlist, Git installs)

`package.json`'s `files` allowlist ships the compiled runtime
(`"files": ["lib", "bin", "cordis.patch.yml", "README.md", "LICENSE", "CHANGELOG.md"]`).
The output is also **committed to Git**, not gitignored, for a reason that is
easy to miss: DSH can install the bundle straight from a Git URL, and **pnpm does
not run a build step for a git dependency**. A Git install would therefore load a
`lib/` that only exists in the working tree if the artifacts are committed. The
`prepack` hook builds (so `npm pack` is always fresh), but a Git checkout is not
packed, so the committed artifacts are the runtime for that path. This is a
deliberate exception to the general "do not commit regenerable artifacts" rule,
and it is the reason rule 8 in [`CONTRIBUTING.md`](CONTRIBUTING.md) names the
compiled runtime explicitly.

### 2.3 Declarations are required, not optional

Because the package is NodeNext ESM and every module is `.ts`, a module that
imports another needs the sibling `.d.ts` for the typecheck program; the emitted
JavaScript alone carries no JSDoc. Without it, TypeScript would load the emitted
JavaScript into the program and fail with hundreds of
`TS7006: Parameter implicitly has an 'any' type` errors. `declaration: true` in
`tsconfig.build.json` guarantees every emitted `.js` has its `.d.ts`.

## 3. The rule for contributors (CURRENT)

1. **New source is `.ts`** under `src/`. A new module goes to
   `src/.../<name>.ts`; nothing new is written as `.js` under `lib/`.
2. **JavaScript is allowed only as** (a) the emitted artifacts under
   `lib/`, or (b) the documented exceptions in §4. Any new exception
   requires an entry in §4 with a rationale, not just a file.
3. **To change a module**: edit `src/.../<name>.ts`, keeping every comment and
   behaviour, run the build (`npm run build`), and import the emitted
   `lib/.../<name>.js` — never edit the generated `.js`. A module whose source is
   missing is a policy violation, and the structural regression fails on it.
4. **Never edit `lib/**` by hand**; it is overwritten by the next build.
   If the build output is stale, `node --test` silently tests stale code — run the
   build before claiming a green suite from a fresh checkout.
5. **No runtime dependency may be added by a migration.** The package's value is
   partly that it mounts in any composition; a relative import and the ambient
   seam are the only allowed dependencies.

## 4. Exception list (CURRENT)

### 4.1 Permanent exceptions

| File | Why it stays as it is |
|---|---|
| `bin/ieg` | The executable shim Node actually runs. Node in this environment cannot execute `.ts` (verified: `process.features.typescript === false`), and the package ships only compiled JavaScript. The interface itself is TypeScript (`src/bin/ieg.ts` → `lib/bin/ieg.js`); this file is a few lines that dynamically `import()` the compiled entry point and set `process.exitCode` — a dynamic import so the extensionless file works whether Node treats it as CommonJS or ESM. It is a **host-mandated bin entry**, not source. |
| `lib/contract.d.ts` | The ambient seam. It is already TypeScript, but it must stay a **global script declaration file** (no imports, no exports) so every type in it is ambient for all of `lib/` and `src/`. Converting it into a module would force an import into every kernel file and destroy the auditable "these are the only host seams, listed in one file" property. It is a **host-mandated contract file**, not an exception to the language rule. |
| `lib/**/*.js`, `lib/**/*.d.ts` | **Build artifacts** (`tsc -p tsconfig.build.json`). Committed so a Git install is self-contained (§2.2). Regenerable, never hand-edited. |
| `lib/compatibility-baseline.json` | Committed **data**, not source: the reviewed compatibility baseline mirror. JSON is the interchange format the diagnostics/compare tooling reads; there is no TypeScript form of a data file. |
| `cordis.patch.yml` | Host configuration format (Cordis patch document), not source code. |

### 4.2 Temporary exceptions — HISTORICAL (none remain)

The migration began with a list of not-yet-migrated JavaScript files under
`lib/**`. **That list is now empty and is not maintained here.** Every runtime
module — the kernel, the three governance modules, the control plane, the prompt
store and lifecycle, the aggregator `src/index.ts`, and the CLI entry
`src/bin/ieg.ts` — has a `.ts` source, and `test/**/*.js` remains JavaScript by
design (it is the test suite, not the shipped runtime). If a hand-written `.js`
ever reappears under `lib/`, `test/integration/packaging.test.js` fails, because
the check is "every built module has a TypeScript source", not a list.

## 5. Migration order — HISTORICAL (executed)

This table recorded the plan of record while the runtime was mid-migration. It is
kept so that older references to "step 3" or "step 8" still resolve; **no step
below is pending work.** The completed state is described in §2 and §4.

| Step | Modules | Lines | Outcome | Why it was ordered here |
|---|---|---:|---|---|
| 1 | `prompt-compiler`, `prompt-override`, `export` | 423 | **done** | Complete leaf closure: pure, no host seams, no legacy imports. Proved the build/emit/declare pipeline end to end. |
| 1b | `control`, `prompt-store`, `lifecycle`, `bin/ieg` | — | **done** | The 0.6.0 control plane and CLI; new source written as TypeScript from the start (rule 1). |
| 2 | `config`, `registry`, `diagnostics`, `durability`, `overlap` | 1499 | **done** | Kernel leaves with no relative imports. |
| 3 | the three `modules/*` | 730 | **done** | Pure policy modules with their own unit tests. |
| 4 | `orientation`, `state` | 375 | **done** | Thin adapters over the modules from step 3. |
| 5 | ~~feedback and GUI-action modules~~ | — | **REMOVED in 0.6.0** | The browser route and in-harness issue reporter were deleted; no migration work remained. |
| 6 | `compatibility` | 658 | **done** | Large but self-contained. |
| 7 | `index.js` → `src/index.ts` | ~1085 | **done** | Last, so `main` kept pointing at `lib/index.js` throughout. |
| 8 | `test/**` + `test-support/dsh.js` | 5395 | **HISTORICAL — not migrated by design** | Blocked on the runner (§6); the test suite is still `.js` and is typechecked through the ambient contract. |
| 9 | `eval/` harness | — | **out of scope** | Outside the shipped package. |

## 6. Tests: why they were step 8 — HISTORICAL

`npm test` is `node --test` and the runner cannot execute `.ts` here (§1.1), so a
TypeScript test source must be compiled before it can run. Two obstacles once
made an in-place test build unsafe:

1. **Generated test JavaScript must land where the runner looks.** `node --test`
   discovers `**/*.test.js` but **not** `.test.ts` (measured: a `.test.ts` in the
   same directory is ignored). In-place emission with `allowJs` is impossible —
   TypeScript refuses to write a `.js` over its own `.js` input
   (`TS5055: Cannot write file … because it would overwrite input file`) — and
   `outDir` equal to the include root is auto-excluded from the program.
2. **The first slice's tests imported un-migrated modules.** `prompt-override.test.js`
   and `prompt-compiler.test.js` import `lib/index.js` and `lib/kernel/config.js`.
   A build that reads no JavaScript (`allowJs: false`) cannot resolve those, and
   one that reads it cannot emit without the `TS5055` collision above.

Both obstacles are recorded here because they explain why the test suite stayed
JavaScript. Migrating `test/**` to `.ts` is **not** a planned work item: the
suite is not shipped, it is typechecked against the same ambient contract, and
`node --test` remains the runner.

## 7. Verification of the migration (CURRENT numbers)

The counts below are the current tree's; re-derive them from the tree rather than
trusting this sentence, and see [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md)
§3–§4 for the maintained status record.

```console
$ npm run typecheck          # tsc against the ambient contract, tsconfig.json  → exit 0
$ npm test                   # pretest builds, then node --test                → 272 pass, 0 fail
$ ./scripts/verify.sh        # the full evidence chain                         → 22/22 checks passed
$ npm pack                   # prepack asserts the artifacts, pack ships lib/**
```

Three independent checks back the claim that the package still works:

- **272 tests, 0 failures** — the current suite, which added the packaging
  regression and the `0.8.0` baseline work on top of the earlier rounds.
  (The migration slice recorded 284 tests against the then-current tree; that
  number is **HISTORICAL**, and the 0.7.0 withdrawal removed the tests that
  carried the difference.)
- **`verify.sh` 22/22** — step 1 runs `npm run build` before the typecheck and
  tests, so a fresh checkout regenerates the artifacts first. The installed-artifact
  check imports the **installed** copy's `lib/index.js` (a real directory in a
  throwaway profile, not a link back to the source tree), applies the **installed
  `cordis.patch.yml` verbatim**, and proves it binds one `ieg:governance` section,
  three listeners, and two tools (`record_orientation`, `ieg_status`).
- **A tarball proof** — `npm pack` + extract + `import <packed>/lib/index.js`
  mounts one `ieg:governance` section and the two tools (`record_orientation`,
  `ieg_status`). The tarball contains **zero** `src/` entries (sources are not
  shipped) and ships the compiled `lib/**` tree.

The original differential run compared the first compiled artifacts against the
JavaScript they replaced for every exported function and constant. It was a
one-off script and is **REMOVED**, because its comparison target no longer exists.

## 8. Residual risks and limits (CURRENT)

- **Stale artifacts.** `node --test` reads `lib/**`, not `src/**`. A `src` edit
  without a rebuild gives a green suite over stale code. The lifecycle wiring
  closes this: `"build": "tsc -p tsconfig.build.json"`, `"pretest": "npm run
  build"`, and `scripts/verify.sh` step 1 (`npm run build`) before the typecheck
  and tests.
- **Committed build output.** The compiled `lib/**` is committed so a Git install
  works (§2.2). A `src` change therefore lands as two coupled edits — the source
  and its emitted artifact — and review must treat a `lib/` diff without a matching
  `src/` diff as a defect. The structural regression asserts the pairing.
- **No `@types/node`.** The tests and `lib/` rely on the narrow ambient seam in
  `lib/contract.d.ts`. A module that needs a new Node API must add that slice to
  the seam rather than importing `@types/node`, and the migration must not widen
  the package's dependency surface.
- **Node version floor.** `engines.node` stays `>=20`. The build needs a
  TypeScript compiler ≥5.8; the emitted JavaScript is plain ES2022 and its
  behaviour on Node 20 is unchanged from the JavaScript it replaced.
- **Not verified.** The migrated artifacts were not exercised against a live
  agent loop (unchanged from the prototype's existing limits). The `ieg` terminal
  interface is exercised only through the compiled `bin/ieg` (the CLI smoke and
  prompt round-trip checks in `verify.sh`), not against a live session.
