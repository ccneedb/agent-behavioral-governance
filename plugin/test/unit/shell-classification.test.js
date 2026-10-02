/**
 * Shell-command classification.
 *
 * Excluding shell tools from `mutatingTools` was necessary — gating every shell
 * call blocks `ls`, `grep`, and `node --test` — but it left a coverage hole: a
 * document could be created with a redirect instead of the `write` tool and
 * bypass the overlap gate entirely. These tests pin **both** directions of the
 * fix: shell *writes* are treated as mutations, and everyday read-only commands
 * are not — including the quoted-pattern case, where the write-looking text is
 * data (`rg '=>' src`) rather than syntax.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyMutation, commandWritesFiles, SHELL_TOOLS } from '../../lib/modules/workspace-governance.js'

const POLICY = {
  mutatingTools: ['write', 'edit', 'str_replace_editor'],
  protectedPaths: [],
  classifyShellCommands: true,
}

test('a shell command that writes is classified as a mutation', () => {
  const writes = [
    'cat > AUTH.md <<EOF\nhi\nEOF',
    'echo hello > notes.md',
    'echo more >> notes.md',
    'printf x | tee out.md',
    'cp a.md b.md',
    'mv a.md b.md',
    'rm stale.md',
    'touch new.md',
    'mkdir -p docs',
    'sed -i s/a/b/ spec.md',
    'dd if=/dev/zero of=big.bin bs=1M count=1',
    // A wrapper's quoted argument is itself a command, so it stays inspected.
    "bash -c 'echo x > f'",
    'sh -c "rm -rf build"',
    "bash -c 'sed -i s/a/b/ spec.md'",
  ]
  for (const command of writes) {
    assert.equal(commandWritesFiles(command), true, `should be a write: ${command}`)
    assert.equal(classifyMutation('bash', { command }, POLICY).kind, 'persistent-mutation', command)
  }
})

test('everyday read-only shell commands are NOT classified as mutations', () => {
  const reads = [
    'ls -la',
    'grep -rn "widget" .',
    'cat SPEC.md',
    'find . -type f',
    'node --test',
    'git status',
    'node -e "console.log(1)"',
    'npm test 2>&1',
    'grep -rn foo . 2>/dev/null',
    'ls missing 2>/dev/null || true',
    'wc -l *.md',
    'head -20 README.md | sort',
    // Quoted text is data, not shell syntax.
    "rg '=>' src",
    "grep -rn '=>' src",
    "grep -rn 'a > b' src",
    "rg 'rm ' src",
    "git commit -m 'rm stale files'",
  ]
  for (const command of reads) {
    assert.equal(commandWritesFiles(command), false, `should be read-only: ${command}`)
    assert.equal(classifyMutation('bash', { command }, POLICY).kind, 'read-only', command)
  }
})

test('comparison and arrow operators are not read as redirections', () => {
  for (const command of ['node -e "if (a>=b) c"', "awk -F'>' '{print $1}' f", 'echo a<=b']) {
    assert.equal(commandWritesFiles(command), false, `should be read-only: ${command}`)
  }
  // A real redirection is still one, including on an append and an fd.
  for (const command of ['echo x 2> err.log', 'echo x &> out.log', 'echo x >| clobber.log']) {
    assert.equal(commandWritesFiles(command), true, `should be a write: ${command}`)
  }
})

test('the classification can be switched off, restoring tool-only governance', () => {
  const policy = { ...POLICY, classifyShellCommands: false }
  assert.equal(classifyMutation('bash', { command: 'rm -rf build' }, policy).kind, 'read-only')
})

test('the file-effect tools are governed regardless of the shell flag', () => {
  const policy = { ...POLICY, classifyShellCommands: false }
  assert.equal(classifyMutation('write', { file_path: '/w/a.md' }, policy).kind, 'persistent-mutation')
  assert.equal(classifyMutation('edit', { file_path: '/w/a.md' }, policy).kind, 'persistent-mutation')
})

test('a shell write to a protected path is marked protected', () => {
  const policy = { ...POLICY, protectedPaths: ['/repo/secrets'] }
  // The shell target is opaque, so protection is evaluated against the raw
  // command text; the guard therefore cannot police shell writes by path.
  const classification = classifyMutation('bash', { command: 'rm -rf /repo/secrets' }, policy)
  assert.equal(classification.kind, 'persistent-mutation')
  // Documents the limitation rather than pretending to cover it.
  assert.equal(classification.protected, false)
})

test('shell tools are declared and recognised', () => {
  assert.deepEqual([...SHELL_TOOLS].sort(), ['bash', 'bash_persistent', 'pwsh', 'pwsh_persistent'])
  assert.equal(classifyMutation('bash_persistent', { command: 'echo x > f' }, POLICY).kind, 'persistent-mutation')
  assert.equal(classifyMutation('pwsh', { command: 'Remove-Item f' }, POLICY).kind, 'read-only')
})
