// A report is untrusted input. Nothing it names outside --root may be opened, and nothing from
// such a file may reach the output (the "closest line" of an altered excerpt would leak it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeWorkspace } from './helpers.js';
import { Workspace } from '../src/workspace.js';
import { runChecks } from '../src/check.js';
import { takeSnapshot } from '../src/changes.js';

const SECRET = 'DATABASE_PASSWORD=fake-secret-value-123';
const GUESS = 'DATABASE_PASSWORD=unknown';

function setup() {
  const base = makeWorkspace({
    'outside/secret.env': `${SECRET}\n`,
    'ws/notes.md': 'The pump was serviced on 12 May.\n',
    'ws/sub/x.md': 'x\n',
  });
  return { base, root: path.join(base, 'ws'), secret: path.join(base, 'outside', 'secret.env') };
}

const run = (root, report, opts = {}) => runChecks(report, new Workspace(root), { allowEmpty: true, ...opts });
// the reports below never contain this part of the secret, so finding it in a result is a leak
const leaks = (res) => JSON.stringify(res).includes('value-123');

test('.. and absolute paths outside the root are refused (text and JSON reports)', () => {
  const { root, secret } = setup();
  const reports = [
    `- ../outside/secret.env:1 "${GUESS}"`,
    `- ${secret}:1 "${GUESS}"`,
    JSON.stringify({ citations: [{ file: '../outside/secret.env', line: 1, quote: GUESS }] }),
    JSON.stringify({ citations: [{ file: secret, line: 1, quote: GUESS }] }),
    // a correct guess must not be confirmed either: that would turn the check into a probe
    JSON.stringify({ citations: [{ file: secret, line: 1, quote: 'DATABASE_PASSWORD=fake' }] }),
  ];
  for (const report of reports) {
    const res = run(root, report);
    const item = res.citations.items[0];
    assert.equal(item.status, 'missing_file', report);
    assert.equal(item.detail.reason, 'outside_root', report);
    assert.equal(res.verdict, 'fail');
    assert.ok(!leaks(res), report);
  }
});

test('paths inside the root still work, absolute or with ..', () => {
  const { root } = setup();
  const quote = 'The pump was serviced on 12 May.';
  for (const file of [path.join(root, 'notes.md'), 'sub/../notes.md', './notes.md']) {
    const res = run(root, JSON.stringify({ citations: [{ file, line: 1, quote }] }));
    assert.equal(res.citations.items[0].status, 'ok', file);
  }
});

test('number expressions cannot read outside the root', () => {
  const { root, secret } = setup();
  for (const f of ['../outside/secret.env', secret.replace(/\\/g, '/')]) {
    const res = run(root, `\`count(${f}, "PASSWORD") = 1\``);
    const n = res.numbers.items[0];
    assert.equal(n.status, 'error', f);
    assert.match(n.detail.reason, /outside the root/);
    assert.equal(n.actual, undefined);
  }
});

test('a listed file outside the root is reported without being looked up', () => {
  const { root } = setup();
  const before = takeSnapshot(new Workspace(root));
  const res = run(root, '[+] ../outside/secret.env\n[+] \\\\server\\share\\x.md', { before });
  const items = res.changes.items;
  assert.equal(items.length, 2);
  for (const i of items) {
    assert.equal(i.status, 'phantom');
    assert.equal(i.outside, true);
    assert.equal(i.exists, false);
  }
});

function tryLink(target, link, type) {
  try { fs.symlinkSync(target, link, type); return true; } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') return false; // Windows without symlink rights
    throw e;
  }
}

test('a file link inside the root that leads out of it is refused', (t) => {
  const { root, secret } = setup();
  if (!tryLink(secret, path.join(root, 'link.env'), 'file')) return t.skip('cannot create symbolic links here');
  const res = run(root, `- link.env:1 "${GUESS}"\n\`count(link.env, "PASSWORD") = 1\``);
  assert.equal(res.citations.items[0].status, 'missing_file');
  assert.equal(res.citations.items[0].detail.reason, 'outside_root');
  assert.equal(res.numbers.items[0].status, 'error');
  assert.ok(!leaks(res));
});

test('a folder junction or link inside the root that leads out of it is refused', (t) => {
  const { base, root } = setup();
  // a junction needs no special rights on Windows; elsewhere this is a plain directory symlink
  if (!tryLink(path.join(base, 'outside'), path.join(root, 'jdir'), 'junction')) return t.skip('cannot create links here');
  const res = run(root, `- jdir/secret.env:1 "${GUESS}"\n\`lines(jdir/secret.env) = 1\``);
  assert.equal(res.citations.items[0].status, 'missing_file');
  assert.equal(res.numbers.items[0].status, 'error');
  assert.ok(!leaks(res));
  // and the index never walks into it
  assert.ok(!new Workspace(root).index().some((r) => r.startsWith('jdir')));
});

test('UNC paths are refused without any file system call', (t) => {
  const { root } = setup();
  const ws = new Workspace(root);
  ws.index(); // walking the root itself is fine; only the report's paths are under test
  const spies = [
    t.mock.method(fs, 'statSync'),
    t.mock.method(fs, 'lstatSync'),
    t.mock.method(fs, 'existsSync'),
    t.mock.method(fs, 'readFileSync'),
    t.mock.method(fs, 'openSync'),
    t.mock.method(fs, 'readlinkSync'),
    t.mock.method(fs, 'readdirSync'),
    t.mock.method(fs.realpathSync, 'native'),
  ];
  const report = [
    `- \\\\server\\share\\secret.env:1 "${GUESS}"`,
    '`count(\\\\server\\share\\log.txt, "x") = 1`',
    '[+] \\\\server\\share\\out.md',
  ].join('\n');
  const json = JSON.stringify({
    citations: [{ file: '//server/share/secret.env', line: 1, quote: GUESS }, { file: '\\\\?\\UNC\\server\\share\\a.md', line: 1, quote: GUESS }],
    numbers: [{ expr: 'lines(//server/share/a.md)', claim: 1 }],
  });
  const before = { tool: 'agent-cite-check', kind: 'snapshot', files: { 'notes.md': { size: 33, sha256: null }, 'sub/x.md': { size: 2, sha256: null } } };
  const r1 = runChecks(report, ws, { before });
  const r2 = runChecks(json, ws, {});
  assert.equal(r1.citations.items[0].detail.reason, 'outside_root');
  assert.deepEqual(r2.citations.items.map((i) => i.detail.reason), ['outside_root', 'outside_root']);
  assert.equal(r1.numbers.items[0].status, 'error');
  assert.equal(r2.numbers.items[0].status, 'error');
  const touched = spies.flatMap((s) => s.mock.calls.map((c) => String(c.arguments[0])));
  assert.deepEqual(touched.filter((p) => /^[\\/]{2}/.test(p)), []);
  assert.ok(!touched.some((p) => /server/.test(p)), touched.join('\n'));
});
