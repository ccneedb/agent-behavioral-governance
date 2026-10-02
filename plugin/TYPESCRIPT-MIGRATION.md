# TypeScript migration — decision, exceptions, and plan

Status: **decision made and first slice migrated, 2026-10-02.**
Owner: `plugin/lib/**`, `plugin/src/**`, `plugin/test/**`, `plugin/tsconfig*.json`.
This file is the durable record the source-of-truth policy points at: **new
source is TypeScript; JavaScript survives only as a build artifact or as an entry
on the exception list below.**

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

ABG is registered by **bare package name** (`name: dsh-agent-behavioral-governance`
in `cordis.patch.yml`), so the rewriter leaves the specifier alone and Node's
`exports.` / `main` decides the file — `lib/index.js` today. The rewriter's
`.ts`→`.js` mapping shows the intended authoring shape: TS in, JS out.

### 1.4 Consequences adopted

- `main` and `exports` stay exactly as before: `lib/index.js`. No public entry
  point is renamed.
- Sources are authored under `plugin/src/**`; `tsc` emits `plugin/lib/generated/**`,
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

## 2. Build model

| Path | Role |
|---|---|
| `src/**/*.ts` | **Source of truth** for migrated modules. Import specifiers use the emitted `.js` extension (NodeNext), exactly as the current JavaScript does. |
| `lib/generated/**/*.js` | **Build artifact.** Never edit by hand; it is what `lib/index.js` and the tests import. |
| `lib/generated/**/*.d.ts` | Build artifact, required for typecheck (see below), not at runtime. |
| `lib/**/*.js` (outside `generated/`) | Not-yet-migrated JavaScript, still typechecked with `checkJs`. |
| `lib/client.js` | Permanent exception — see §4. |
| `lib/contract.d.ts` | Permanent exception — see §4. |

Rebuild after any `src/` edit:

```bash
cd plugin
npx tsc -p tsconfig.build.json     # or: npm run build, once the script key is wired
```

`tsconfig.json` (the `npm run typecheck` project) includes `lib` **and** `src`
and excludes `lib/client.js` and `lib/generated`. Declarations are emitted for a
reason that is easy to trip over: `lib/index.js` is still JavaScript and imports
`lib/generated/kernel/*.js`. Without a sibling `.d.ts`, TypeScript would load the
**emitted JavaScript into the `checkJs` program** and fail with hundreds of
`TS7006: Parameter implicitly has an 'any' type` errors (emitted JavaScript
carries no JSDoc). Proof:

```console
# with lib/generated/kernel/*.d.ts present
$ npx tsc -p tsconfig.json ; echo $?
0
# with one .d.ts removed, nothing else changed
lib/generated/kernel/mod.js(1,23): error TS7006: Parameter 't' implicitly has an 'any' type.
```

So a migrated module's directory must always contain both the emitted `.js` and
its `.d.ts`; `declaration: true` in `tsconfig.build.json` guarantees that.

## 3. The rule for future contributors

1. **New source is `.ts`** under `plugin/src/`. A new module goes to
   `src/.../<name>.ts`; nothing new is written as `.js` under `lib/`.
2. **JavaScript is allowed only as** (a) the emitted artifacts under
   `lib/generated/`, or (b) the documented exceptions in §4. Any new exception
   requires an entry in §4 with a rationale, not just a file.
3. **To migrate a module**: move `lib/x.js` → `src/x.ts` (adding types, keeping
   every comment and every behaviour), run the build, re-point every importer of
   `lib/x.js` to `lib/generated/x.js`, delete `lib/x.js`, and run
   `npm run typecheck && npm test && ./scripts/verify.sh`.
4. **Never edit `lib/generated/**` by hand**; it is overwritten by the next build.
   If the build output is stale, `node --test` silently tests stale code — run the
   build before claiming a green suite from a fresh checkout.
5. **No runtime dependency may be added by a migration.** The package's value is
   partly that it mounts in any composition; a relative import and the ambient
   seam are the only allowed dependencies.

## 4. Exception list

### 4.1 Permanent exceptions

| File | Why it stays as it is |
|---|---|
| `lib/client.js` | The Web GUI browser half. A DSH client plugin normally ships a bundle produced by the host monorepo's build, and no public out-of-tree build exists, so this file is hand-authored **directly against the host's browser envelope** (`window.__ModuleLoader__.load({id, factory})`, baseline `require`, browser globals, the `slots` registry). It is not Node source and is not loadable by Node; `tsc` cannot meaningfully check it and `tsconfig.json` excludes it for exactly the reason first-party built client artifacts are excluded. It is a **host-mandated contract file**. |
| `lib/contract.d.ts` | The ambient seam. It is already TypeScript, but it must stay a **global script declaration file** (no imports, no exports) so every type in it is ambient for all of `lib/`. Converting it into a module would force an import into every kernel file and destroy the auditable "these are the only host seams, listed in one file" property. It is a **host-mandated contract file**, not an exception to the language rule. |
| `lib/generated/**/*.js`, `lib/generated/**/*.d.ts` | **Build artifacts** (`tsc -p tsconfig.build.json`). Regenerable, never hand-edited. |
| `lib/compatibility-baseline.json` | Committed **data**, not source: the reviewed compatibility baseline mirror. JSON is the interchange format the diagnostics/compare tooling reads; there is no TypeScript form of a data file. |
| `cordis.patch.yml` | Host configuration format (Cordis patch document), not source code. |

### 4.2 Temporary exceptions — JavaScript still pending migration

Everything below is existing JavaScript. It is covered by §5 and is expected to
shrink to zero. Until then it is typechecked by `checkJs` exactly as before.

| Path | Lines | Note |
|---|---:|---|
| `lib/index.js` | 1170 | The aggregation point; migrates **last** (`main` must keep pointing here throughout). |
| `lib/kernel/*.js` (11 files) | 3303 | `compatibility` 658, `diagnostics` 442, `config` 360, `overlap` 330, `feedback` 312, `orientation` 291, `registry` 264, `questions` 211, `gui-actions` 177, `durability` 171, `state` 87. |
| `lib/modules/*.js` (4 files) | 1092 | `user-attention` 389, `workspace-governance` 331, `information-integrity` 206, `project-governance` 166. |
| `test/**/*.js` (26 files) | 5545 | Test migration is **blocked** on the runner, not on willingness — see §6. |
| `test-support/dsh.js` | 64 | Same blocker. |
| `eval/**/*.mjs` | — | The behavioural harness is outside the shipped package and outside this slice's scope; it is JavaScript pending the same treatment. |
| `plugin/scripts/*.sh` | — | Shell, not JavaScript. |

Already migrated (2026-10-02): `lib/kernel/prompt-compiler.js`,
`lib/kernel/prompt-override.js`, `lib/kernel/export.js` → `src/kernel/*.ts`
(423 lines of JavaScript removed from `lib/kernel/`).

## 5. Migration order and estimates

Order is dependency order: leaves first, aggregator last. Each step is one
focused change set with its tests re-pointed, and each step must end with
`npm run typecheck && npm test && ./scripts/verify.sh` green.

| Step | Modules | Lines | Estimate | Why here |
|---|---|---:|---|---|
| 1 ✅ | `prompt-compiler`, `prompt-override`, `export` | 423 | done | Complete leaf closure: pure, no host seams, no legacy imports. Proves the build/emit/declare pipeline end to end. |
| 2 | `config`, `registry`, `diagnostics`, `durability`, `overlap` | 1567 | 1–1.5 days | Kernel leaves with no relative imports. `config` first: `feedback`, `gui-actions` and `index` all import it. Unit tests already exist for each. |
| 3 | four `lib/modules/*.js` | 1092 | 1 day | Pure policy modules with their own unit tests; only then can the kernel adapters resolve. |
| 4 | `orientation`, `questions`, `state` | 589 | 0.5 day | Thin adapters over the modules from step 3; `state` depends on both. |
| 5 | `feedback`, `gui-actions` | 489 | 0.5 day | Depend on `config` (step 2) and the migrated prompt modules (step 1). |
| 6 | `compatibility` | 658 | 0.5–1 day | Large but self-contained; watch the ambient logging/host types. |
| 7 | `index.js` → `src/index.ts` | 1170 | 1–1.5 days | Last: every other import is generated by then, and `main` keeps pointing at `lib/index.js`. |
| 8 | tests + `test-support/dsh.js` | 5609 | 1.5–2 days | Blocked on the test runner (see §6). |
| 9 | `eval/` harness | — | separate | Out of the shipped package. |

Total for the production tree (§5 steps 2–7): roughly **5–7 working days** for
one contributor at the observed code density.

## 6. Tests: why they are step 8, not step 1

`npm test` is `node --test` and the runner cannot execute `.ts` here (§1.1), so a
TypeScript test source must be compiled before it can run. Two further obstacles
made an in-place test build unsafe in this slice:

1. **Generated test JavaScript must land where the runner looks.** `node --test`
   discovers `**/*.test.js` but **not** `.test.ts` (measured: a `.test.ts` in the
   same directory is ignored). In-place emission with `allowJs` is impossible —
   TypeScript refuses to write a `.js` over its own `.js` input
   (`TS5055: Cannot write file … because it would overwrite input file`) — and
   `outDir` equal to the include root is auto-excluded from the program.
2. **The slice's tests import un-migrated modules.** `prompt-override.test.js`
   and `prompt-compiler.test.js` import `lib/index.js` and `lib/kernel/config.js`.
   A build that reads no JavaScript (`allowJs: false`) cannot resolve those, and
   one that reads it cannot emit without the `TS5055` collision above.

Both obstacles disappear once steps 2–7 have produced declaration output for the
modules the tests import. Step 8 therefore becomes mechanical: add a
`tsconfig.test.json` (in-place emission, `allowJs: false`), convert
`test/**/*.test.js` to `.ts`, and keep `node --test` as the runner against the
emitted `.js`. Until then the migrated modules are proven by the **existing**
tests, unchanged except for their import specifiers.

## 7. Verification of this slice

```console
$ npm run typecheck          # tsc --checkJs strict, tsconfig.json          → exit 0
$ npm test                   # pretest builds, then node --test             → 265 pass, 0 fail
$ ./scripts/verify.sh        # the full evidence chain                     → 12/12 checks passed
$ npm pack                   # prepack asserts the artifacts, pack ships lib/generated/**
```

Three independent checks back the claim that the package still works:

- **265 tests, 0 failures** — the 259 pre-existing tests plus 6 new configuration
  regression tests; every pre-existing test is byte-identical except for the
  import specifier of a migrated module.
- **`verify.sh` 12/12** — step 1 now runs `npm run build` before the typecheck and
  tests, so a fresh checkout regenerates the artifacts first. Check 6 imports the
  **installed** copy's `lib/index.js` (a real directory in a throwaway profile,
  not a link back to the source tree), applies the **installed
  `cordis.patch.yml` verbatim**, and proves it binds one `abg:governance` section,
  three listeners, and five tools. That import resolves the generated artifacts
  from the install.
- **A tarball proof** — `npm pack` + extract + `import <packed>/lib/index.js`
  mounts one `abg:governance` section and the five tools. The tarball contains
  `lib/generated/kernel/{prompt-compiler,prompt-override,export}.{js,d.ts}`,
  contains **zero** `src/` entries (sources are not shipped), and no longer
  contains the three legacy `lib/kernel/*.js` files.

The differential run compared the compiled artifacts against the JavaScript they
replaced for every exported function and constant (`prompt-compiler`,
`prompt-override`, `export`), including error messages, throttling, and the
re-entrancy guard, and asserted object equality on every result. It was run
**before** the legacy files were deleted and was a one-off script, now removed
because its comparison target no longer exists.

## 8. Residual risks and limits

- **Stale artifacts.** `node --test` reads `lib/generated/**`, not `src/**`. A
  `src` edit without a rebuild gives a green suite over stale code. Mitigation is
  wired in the lifecycle change set: `"build": "tsc -p tsconfig.build.json"`,
  `"pretest": "npm run build"`, and `scripts/verify.sh` step 1
  (`npm run build`) before the typecheck and tests — so both `npm test` and the
  gate rebuild first, including from a fresh checkout. The `prepack` hook asserts
  `lib/generated/kernel/*.js` exist, so a package can no longer be produced
  without them.
- **`npm pack` and regenerable artifacts.** The repository's rule is "do not
  commit regenerable artifacts", but the installed package must contain
  `lib/generated/**`. **Measured:** the `files: ["lib"]` allowlist wins over an
  ignore rule — a scratch package whose `.gitignore` contained `lib/generated/`
  still packed all six generated files (`npm pack` + `tar -tzf` → 6/6 present).
  So gitignoring `plugin/lib/generated/` is safe for the tarball, and is the
  consistent reading of rule 8. **Coupled change required:** if the directory is
  ignored *and* not committed, `prepack`'s current assertion (`fs.accessSync`)
  would fail on a fresh clone, because `npm pack` does not build. `prepack` must
  therefore run the build (`"prepack": "npm run build"`, or build-then-assert),
  which is a `scripts`-key change owned by the lifecycle change set. With that
  wiring, the workflow is: fresh clone → `npm test` / `verify.sh` / `npm pack`
  all build first. Verified here: the emitted artifacts are present in the
  working tree and therefore in the install used by `verify.sh`, and the real
  `npm pack` shipped them.
- **No `@types/node`.** The tests and `lib/` rely on the narrow ambient seam in
  `lib/contract.d.ts`, exactly as before. A migrated module that needs a new Node
  API must add that slice to the seam rather than importing `@types/node`, and the
  migration must not widen the package's dependency surface.
- **Node version floor.** `engines.node` stays `>=20`. The build needs a
  TypeScript compiler ≥5.8 (recommended by Node for matching runtimes); the
  runtime JavaScript is plain ES2022 and its behaviour on Node 20 is unchanged
  from the JavaScript it replaced (same `target` as the previous `tsconfig.json`).
- **Not verified.** The migrated artifacts were not exercised against a live
  agent loop (unchanged from the prototype's existing limits), and the
  browser-side `lib/client.js` remains hand-authored and unchecked.
