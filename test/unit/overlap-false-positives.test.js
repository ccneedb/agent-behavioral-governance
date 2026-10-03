/**
 * False-positive guard for the document-overlap gate.
 *
 * The subject signal was strengthened twice in response to real evaluation
 * failures — first by comparing filename subjects against headings, then by
 * matching short forms (`auth` ≈ `authentication`). Each change made it more
 * aggressive, and an over-eager gate is worse than a leaky one: under the `ask`
 * default it costs the user an approval prompt, and under `deny` it blocks
 * legitimate work.
 *
 * These cases exist to pin the boundary. Every document here is a plausible,
 * legitimate new file that must NOT be gated.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectOverlap } from '../../lib/kernel/overlap.js'

const SPEC = `# Widget Service — Specification

Status: current and authoritative.

## API surface (v2)

| Operation | Endpoint |
|---|---|
| list | GET /v2/widgets |
| create | POST /v2/widgets |

## Authentication

Every request carries a bearer token in the Authorization header.

## Storage

Widgets live in the widgets table.
`

const API_REFERENCE = `# Widget API Reference

## Endpoints

## Authentication

## Rate limits
`

const EXISTING = [
  { path: 'SPEC.md', content: SPEC },
  { path: 'API-REFERENCE.md', content: API_REFERENCE },
  { path: 'README.md', content: '# Widget Service\n\nIndex of docs.\n' },
]

/**
 * @param {string} path
 * @param {string} content
 * @returns {ReturnType<typeof detectOverlap>}
 */
function judge(path, content) {
  return detectOverlap({ path, content, existing: EXISTING })
}

test('a genuinely new topic is not gated', () => {
  const verdict = judge('DEPLOYMENT.md', '# Deployment runbook\n\nRoll the canary forward in increments.\n')
  assert.equal(verdict.overlapping, false, JSON.stringify(verdict.details))
})

test('a filename that merely starts like a heading is not gated', () => {
  // "authors" begins with the letters of "auth", but is not a form of
  // "authentication" — a naive substring rule would wrongly gate this.
  const verdict = judge('AUTHORS.md', '# Authors\n\nMaintainers of this project.\n')
  assert.equal(verdict.overlapping, false, JSON.stringify(verdict.details))
})

test('a plural or near-miss of a heading is not gated', () => {
  // "stores" and "storage" share a stem but neither is a prefix of the other.
  const verdict = judge('STORES.md', '# Stores\n\nWhere we keep things.\n')
  assert.equal(verdict.overlapping, false, JSON.stringify(verdict.details))
})

test('an unrelated changelog is not gated', () => {
  assert.equal(judge('CHANGELOG.md', '# Changelog\n\n## 1.0.0\n\nInitial release.\n').overlapping, false)
})

test('a short generic filename is not gated by the length floor', () => {
  // Tokens shorter than four characters are ignored, so "API.md" carries no
  // subject tokens at all and cannot trip the gate.
  const verdict = judge('API.md', '# API\n\nShort pointer to the spec.\n')
  assert.equal(verdict.subject, false)
})

test('the boundary still holds for the cases that must fire', () => {
  // The same corpus DOES gate the failure mode the evaluation produced.
  assert.equal(judge('AUTHENTICATION.md', '# Widget Service Authentication\n\nHow to authenticate.\n').overlapping, true)
  assert.equal(judge('AUTH.md', '# Auth\n\nHow to authenticate.\n').overlapping, true)
})
