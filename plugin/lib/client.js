/**
 * ABG Web GUI client bundle — HAND-AUTHORED, do not edit as if it were built.
 *
 * Why this file is hand-written: a DSH client plugin normally ships a
 * `lib/client.js` produced by the monorepo's `pnpm run build` (tsdown). There is
 * no public out-of-tree build, and the host fails activation loudly for a missing
 * bundle, so this file is written directly against the two documented contracts:
 *
 *   1. the lazy-CJS envelope `window.__ModuleLoader__.load({ id, factory })`,
 *      where `id` is the package name and the factory receives a `require` that
 *      resolves only the frozen baseline (`PLATFORM_MODULES`: React, React
 *      jsx-runtime, Cordis, static UI libraries) plus anything declared in
 *      `dsh.client.external`;
 *   2. the slot registry: `inject = ['slots']`, then `ctx.slots.inject(name, …)`
 *      and `ctx.slots.register({ name, … }, Component)`.
 *
 * It registers one sidebar entry and one main panel, and reads its data from the
 * host route `/api/abg/status` (see `STATUS_ROUTE_PATH` in `lib/index.js`), which
 * serves the same JSON contract as the `abg_status` tool and the diagnostics
 * mirror. It therefore needs no host RPC surface of its own.
 *
 * No build step: edit this file and re-install the plugin into the profile.
 */

// eslint-disable-next-line no-undef -- the browser module table provides this.
window.__ModuleLoader__.load({
	id: 'dsh-agent-behavioral-governance',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		/** The baseline module table seeds React and its jsx runtime. */
		const { jsx, jsxs } = require('react/jsx-runtime')
		const { useEffect, useState } = require('react')

		/** Shared by the sidebar entry and the main panel: one identity, two seats. */
		const PANEL_ID = 'dsh.abg.status'
		const NS = 'dsh-agent-behavioral-governance'
		const STATUS_PATH = '/api/abg/status'
		const REFRESH_MS = 5000

		/** Required service: the UI slot registry. */
		const inject = ['slots']

		const muted = { color: 'var(--dsh-color-fg-muted, #777)' }
		const row = { display: 'flex', gap: '8px', padding: '2px 0' }
		const key = { minWidth: '132px', ...muted }
		const code = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' }
		const panel = { padding: '16px', display: 'grid', gap: '12px', alignContent: 'start' }
		const section = { border: '1px solid var(--dsh-color-border, #3333)', borderRadius: '8px', padding: '12px' }
		const heading = { margin: '0 0 8px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.04em', ...muted }

		/**
		 * Poll the host route. Deliberately simple: no store, no RPC, no cache —
		 * the panel is a read-only view of state the host already exposes.
		 * @returns {{phase: string, payload?: any, message?: string}}
		 */
		function useStatus() {
			const [state, setState] = useState({ phase: 'loading' })
			useEffect(() => {
				let cancelled = false
				const load = () => {
					fetch(STATUS_PATH, { headers: { accept: 'application/json' } })
						.then((response) => {
							if (!response.ok) throw new Error(`HTTP ${response.status} from ${STATUS_PATH}`)
							return response.json()
						})
						.then((payload) => {
							if (!cancelled) setState({ phase: 'ready', payload })
						})
						.catch((error) => {
							if (!cancelled) setState({ phase: 'error', message: String((error && error.message) || error) })
						})
				}
				load()
				const timer = setInterval(load, REFRESH_MS)
				return () => {
					cancelled = true
					clearInterval(timer)
				}
			}, [])
			return state
		}

		/** @param {{ label: string, value: any }} props */
		function Field({ label, value }) {
			return jsx('div', { style: row, children: [jsx('span', { style: key, children: label }), jsx('span', { style: code, children: String(value) })] })
		}

		/** The panel body: mount record, status line, and the diagnostic ring. */
		function AbgStatusPanel() {
			const state = useStatus()
			if (state.phase === 'loading') return jsx('div', { style: panel, children: 'Reading ABG status…' })
			if (state.phase === 'error') {
				return jsxs('div', {
					style: panel,
					children: [
						jsx('strong', { children: 'ABG status is unavailable' }),
						jsx('div', { style: code, children: state.message }),
						jsx('div', {
							style: muted,
							children: 'Install ABG into this profile (dsh plugin --profile <name> add <package>) and check scripts/check-install.sh.',
						}),
					],
				})
			}

			const { mount = {}, status_line: statusLine = '', diagnostics = [], counts = {} } = state.payload ?? {}
			const degraded = Array.isArray(mount.degraded) ? mount.degraded : []
			return jsxs('div', {
				style: panel,
				children: [
					jsxs('div', {
						style: section,
						children: [
							jsx('h3', { style: heading, children: 'Governance state' }),
							jsx(Field, { label: 'mounted', value: String(mount.mounted) }),
							jsx(Field, { label: 'degraded', value: degraded.length === 0 ? 'none' : degraded.join(', ') }),
							jsx(Field, { label: 'modules', value: (mount.modules ?? []).length }),
							jsx(Field, { label: 'compatibility', value: (mount.compatibility && mount.compatibility.verdict) || 'unknown' }),
							jsx(Field, { label: 'PROMPT_VERSION', value: mount.promptVersion ?? 'unknown' }),
							jsx(Field, { label: 'prompt overridden', value: String(mount.promptOverridden) }),
							jsx(Field, { label: 'prompt bytes', value: `${mount.promptBytes ?? '?'} (compiled ${mount.compiledPromptBytes ?? '?'})` }),
							jsx('div', { style: { ...code, ...muted, marginTop: '6px' }, children: statusLine }),
						],
					}),
					jsxs('div', {
						style: section,
						children: [
							jsx('h3', { style: heading, children: `Diagnostics (${Object.values(counts).reduce((a, b) => a + b, 0)} recorded)` }),
							diagnostics.length === 0
								? jsx('div', { style: muted, children: 'Nothing recorded yet.' })
								: jsx('div', {
										style: { display: 'grid', gap: '2px' },
										children: diagnostics.slice(0, 20).map((entry, index) =>
											jsx(
												'div',
												{
													style: code,
													children: `${entry.code}${entry.module ? ` (${entry.module})` : ''}${entry.time ? `  ${entry.time}` : ''}`,
												},
												`${entry.code}-${index}`,
											),
										),
									}),
						],
					}),
					jsx('div', {
						style: muted,
						children: 'Read-only. ABG supplements the host prompt; it is a prototype and its behavioural gates are unmeasured.',
					}),
				],
			})
		}

		/** The sidebar glyph: a small diamond, no imaging dependency. */
		function AbgPanelIcon() {
			return jsx('span', { 'aria-hidden': 'true', children: '\u25C6' })
		}

		/**
		 * Client plugin body. One identity in two seats, which is how the layout
		 * links a sidebar entry to its main-slot occupant.
		 * @param {any} ctx
		 */
		function apply(ctx) {
			ctx.slots.inject('sidebar.panellist', () =>
				ctx.slots.register(
					{ name: 'sidebar.panellist', id: PANEL_ID, order: 90, label: () => 'ABG', locale: NS },
					AbgPanelIcon,
				),
			)
			ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, AbgStatusPanel))
		}

		exports.PANEL_ID = PANEL_ID
		exports.NS = NS
		exports.apply = apply
		exports.inject = inject
		return module.exports
	},
})
