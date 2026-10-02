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
 * It registers one sidebar entry and one main panel. All data comes from the
 * plugin's own host routes under `/api/abg/…` — `/status` (read), `/prompt`
 * (POST), `/feedback` (POST) — so this bundle needs no RPC surface of its own,
 * and every rule (prompt validation, feedback redaction) stays in the tested
 * Node kernel instead of being reimplemented here.
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
		const { useCallback, useEffect, useState } = require('react')

		/** Shared by the sidebar entry and the main panel: one identity, two seats. */
		const PANEL_ID = 'dsh.abg.status'
		const NS = 'dsh-agent-behavioral-governance'
		const STATUS_PATH = '/api/abg/status'
		const PROMPT_PATH = '/api/abg/prompt'
		const FEEDBACK_PATH = '/api/abg/feedback'
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
		const button = { font: 'inherit', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--dsh-color-border, #3336)', background: 'transparent', color: 'inherit', cursor: 'pointer' }
		const input = { ...code, padding: '6px', borderRadius: '6px', border: '1px solid var(--dsh-color-border, #3336)', background: 'transparent', color: 'inherit', width: '100%' }
		const textarea = { ...code, padding: '8px', borderRadius: '6px', border: '1px solid var(--dsh-color-border, #3336)', background: 'transparent', color: 'inherit', width: '100%', minHeight: '160px', resize: 'vertical' }
		const link = { ...code, color: 'var(--dsh-color-accent, #4a9eff)' }
		const pre = { ...code, whiteSpace: 'pre-wrap', maxHeight: '220px', overflow: 'auto', padding: '8px', borderRadius: '6px', border: '1px solid var(--dsh-color-border, #3333)' }

		/** POST JSON and read JSON back, surfacing the server's own message. */
		async function postJson(path, body) {
			const response = await fetch(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify(body ?? {}),
			})
			let payload = null
			try {
				payload = await response.json()
			} catch (error) {
				payload = { error: `HTTP ${response.status}` }
			}
			return { status: response.status, payload }
		}

		/**
		 * Poll the host status route. Deliberately simple: no store, no RPC, no
		 * cache — the panel is a view of state the host already exposes.
		 */
		function useStatus() {
			const [state, setState] = useState({ phase: 'loading' })
			const reload = useCallback(() => {
				fetch(STATUS_PATH, { headers: { accept: 'application/json' } })
					.then((response) => {
						if (!response.ok) throw new Error(`HTTP ${response.status} from ${STATUS_PATH}`)
						return response.json()
					})
					.then((payload) => setState({ phase: 'ready', payload }))
					.catch((error) => setState({ phase: 'error', message: String((error && error.message) || error) }))
			}, [])

			useEffect(() => {
				reload()
				const timer = setInterval(reload, REFRESH_MS)
				return () => clearInterval(timer)
			}, [reload])

			return { state, reload }
		}

		/** @param {{ label: string, value: any }} props */
		function Field({ label, value }) {
			return jsx('div', { style: row, children: [jsx('span', { style: key, children: label }), jsx('span', { style: code, children: String(value) })] })
		}

		/** The prompt editor. Read-only unless the deployment set mode/file. */
		function PromptEditor({ prompt, onApplied }) {
			const [text, setText] = useState(prompt ? prompt.text : '')
			const [message, setMessage] = useState(null)
			const [busy, setBusy] = useState(false)

			useEffect(() => {
				if (prompt) setText(prompt.text)
			}, [prompt && prompt.text])

			if (!prompt) return null

			const bytes = text.length
			const over = bytes > prompt.budget
			const apply = async () => {
				setBusy(true)
				const result = await postJson(PROMPT_PATH, { text })
				setBusy(false)
				if (result.status === 200) {
					setMessage({ kind: 'ok', text: `Applied ${bytes} bytes · ${result.payload.version}` })
					if (onApplied) onApplied()
				} else {
					const issues = result.payload.issues || []
					setMessage({ kind: 'error', text: [result.payload.error].concat(issues).filter(Boolean).join(' — ') })
				}
			}

			return jsxs('div', {
				style: section,
				children: [
					jsx('h3', { style: heading, children: 'Prompt' }),
					jsxs('div', { style: { display: 'flex', gap: '24px', flexWrap: 'wrap' }, children: [
						jsx(Field, { label: 'mode', value: prompt.mode }),
						jsx(Field, { label: 'file', value: prompt.file || '(none)' }),
					] }),
					jsx('div', {
						style: { ...code, ...muted, margin: '4px 0' },
						children: `${bytes} bytes · budget ${prompt.budget}${over ? ' · OVER BUDGET' : ''} · ${prompt.overridden ? 'user-edited' : 'compiled default'}`,
					}),
					jsx('textarea', {
						style: textarea,
						value: text,
						readOnly: !prompt.editable,
						onChange: (event) => setText(event.target.value),
					}),
					jsxs('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }, children: [
						jsx('button', { style: { ...button, opacity: prompt.editable && !busy ? 1 : 0.5 }, disabled: !prompt.editable || busy, onClick: apply, children: busy ? 'Applying…' : 'Apply' }),
						jsx('button', { style: { ...button, opacity: prompt.editable ? 1 : 0.5 }, disabled: !prompt.editable, onClick: () => setText(prompt.text), children: 'Revert' }),
						message ? jsx('span', { style: { ...code, color: message.kind === 'ok' ? 'inherit' : '#e5534b' }, children: message.text }) : null,
					] }),
					jsx('div', { style: { ...muted, marginTop: '6px' }, children: prompt.hint }),
					prompt.overridden && prompt.unchecked && prompt.unchecked.length > 0
						? jsxs('div', { style: { ...muted, marginTop: '6px' }, children: [
								'Not verified on user text: ',
								jsx('span', { style: code, children: prompt.unchecked.join('; ') }),
							] })
						: null,
				],
			})
		}

		/** The feedback form: composes through the host, so redaction is shared. */
		function FeedbackForm({ feedback }) {
			const [form, setForm] = useState({ summary: '', expected: '', actual: '' })
			const [preview, setPreview] = useState(null)
			const [message, setMessage] = useState(null)
			const [busy, setBusy] = useState(false)
			if (!feedback || !feedback.enabled) return null

			const submit = async (file) => {
				setBusy(true)
				const body = { summary: form.summary, expected: form.expected, actual: form.actual }
				if (file) body.file = true
				const result = await postJson(FEEDBACK_PATH, body)
				setBusy(false)
				if (result.status !== 200) {
					setMessage({ kind: 'error', text: result.payload.error || `HTTP ${result.status}` })
					return
				}
				setPreview(result.payload)
				if (file) {
					const reason = (result.payload.file_result || {}).reason
					setMessage(result.payload.filed ? { kind: 'ok', text: `Filed: ${result.payload.issue_url}` } : { kind: 'error', text: String(reason || 'not filed') })
				} else {
					setMessage(null)
				}
			}

			const field = (name, label, placeholder) =>
				jsxs('div', { children: [
					jsx('div', { style: { ...muted, marginTop: '8px' }, children: label }),
					jsx('input', {
						style: input,
						value: form[name],
						placeholder,
						onChange: (event) => setForm(Object.assign({}, form, { [name]: event.target.value })),
					}),
				] })

			return jsxs('div', {
				style: section,
				children: [
					jsx('h3', { style: heading, children: 'Report a deviation' }),
					jsx('div', { style: muted, children: 'Composed by the host with redaction: no file contents, prompts, session logs, credentials, or agent identifiers.' }),
					field('summary', 'What happened (required)', 'The overlap gate blocked a genuinely new document'),
					field('expected', 'What you expected', 'the write should have been admitted'),
					field('actual', 'What happened instead', 'it was denied as a duplicate'),
					jsxs('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }, children: [
						jsx('button', { style: { ...button, opacity: busy || !form.summary.trim() ? 0.5 : 1 }, disabled: busy || !form.summary.trim(), onClick: () => submit(false), children: busy ? 'Working…' : 'Preview' }),
						preview ? jsx('button', { style: button, onClick: () => { try { navigator.clipboard.writeText(preview.markdown) } catch (error) { /* clipboard may be unavailable */ } }, children: 'Copy report' }) : null,
						preview ? jsx('a', { style: link, href: preview.issue_url, target: '_blank', rel: 'noreferrer', children: 'Open prefilled issue ↗' }) : null,
						preview && feedback.can_file ? jsx('button', { style: { ...button, opacity: busy ? 0.5 : 1 }, disabled: busy, onClick: () => submit(true), children: 'File issue' }) : null,
					] }),
					message ? jsx('div', { style: { ...code, marginTop: '6px', color: message.kind === 'ok' ? 'inherit' : '#e5534b' }, children: message.text }) : null,
					preview ? jsx('pre', { style: { ...pre, marginTop: '8px' }, children: preview.markdown }) : null,
				],
			})
		}

		/** The panel body: status, prompt editor, diagnostics, and feedback. */
		function AbgStatusPanel() {
			const { state, reload } = useStatus()
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

			const payload = state.payload || {}
			const mount = payload.mount || {}
			const statusLine = payload.status_line || ''
			const diagnostics = payload.diagnostics || []
			const counts = payload.counts || {}
			const degraded = Array.isArray(mount.degraded) ? mount.degraded : []
			const recorded = Object.keys(counts).reduce((total, name) => total + counts[name], 0)
			return jsxs('div', {
				style: panel,
				children: [
					jsxs('div', {
						style: section,
						children: [
							jsx('h3', { style: heading, children: 'Governance state' }),
							jsx(Field, { label: 'mounted', value: String(mount.mounted) }),
							jsx(Field, { label: 'degraded', value: degraded.length === 0 ? 'none' : degraded.join(', ') }),
							jsx(Field, { label: 'modules', value: (mount.modules || []).length }),
							jsx(Field, { label: 'compatibility', value: (mount.compatibility && mount.compatibility.verdict) || 'unknown' }),
							jsx(Field, { label: 'PROMPT_VERSION', value: mount.promptVersion || 'unknown' }),
							jsx(Field, { label: 'prompt overridden', value: String(mount.promptOverridden) }),
							jsx(Field, { label: 'prompt bytes', value: `${mount.promptBytes} (compiled ${mount.compiledPromptBytes})` }),
							jsx('div', { style: { ...code, ...muted, marginTop: '6px' }, children: statusLine }),
						],
					}),
					jsx(PromptEditor, { prompt: payload.prompt, onApplied: reload }),
					jsxs('div', {
						style: section,
						children: [
							jsx('h3', { style: heading, children: `Diagnostics (${recorded} recorded)` }),
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
					jsx(FeedbackForm, { feedback: payload.feedback }),
					jsx('div', {
						style: muted,
						children: 'Read-only except the prompt editor and the feedback form. ABG supplements the host prompt; it is a prototype and its behavioural gates are unmeasured.',
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
