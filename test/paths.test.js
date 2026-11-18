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

test('canonical containment preserves directory case', (t) => {
  const { root } = setup();
  const native = fs.realpathSync.native;
  const canonical = native(root);
  t.mock.method(fs.realpathSync, 'native', (p) => p === root ? canonical : path.join(path.dirname(canonical), 'WS', 'notes.md'));
  assert.equal(new Workspace(root).locate(path.join(root, 'notes.md')), 'outside');
});

test('a location decision is refreshed before use', (t) => {
  const { root, base } = setup();
  const ws = new Workspace(root);
  const file = path.join(root, 'notes.md');
  assert.equal(ws.locate(file), 'inside');
  const native = fs.realpathSync.native;
  t.mock.method(fs.realpathSync, 'native', (p) => p === file ? path.join(base, 'outside', 'notes.md') : native(p));
  assert.equal(ws.locate(file), 'outside');
});

test('text and snapshot reads use a verified descriptor', (t) => {
  const { root } = setup();
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (fd, ...args) => {
    assert.equal(typeof fd, 'number');
    return read(fd, ...args);
  });
  const ws = new Workspace(root);
  assert.equal(ws.load(path.join(root, 'notes.md')).lines.length, 1);
  assert.ok(takeSnapshot(ws).files['notes.md'].sha256);
});

test('an outside junction is rejected before target metadata queries', (t) => {
  const { root, base } = setup();
  const link = path.join(root, 'linked');
  if (!tryLink(path.join(base, 'outside'), link, 'junction')) return t.skip('junction unavailable');
  const before = takeSnapshot(new Workspace(root));
  const candidate = path.join(link, 'secret.env');
  const stat = t.mock.method(fs, 'statSync');
  const exists = t.mock.method(fs, 'existsSync');
  const res = run(root, 'linked/secret.env:1 "sample"\n[+] linked/secret.env', { before });
  assert.equal(res.changes.items[0].outside, true);
  for (const spy of [stat, exists]) assert.ok(!spy.mock.calls.some(c => c.arguments[0] === candidate));
});

test('UNC names cannot match local suffixes or empty globs', () => {
  const { root } = setup();
  const before = takeSnapshot(new Workspace(root));
  fs.appendFileSync(path.join(root, 'notes.md'), 'changed');
  const name = '//server/share/notes.md';
  const res = run(root, JSON.stringify({
    citations: [{ file: name, line: 1, quote: 'The pump' }],
    numbers: [{ expr: 'files(//server/share/*.md)', claim: 0 }],
    files: [name],
  }), { before });
  assert.equal(res.citations.items[0].detail?.reason, 'outside_root');
  assert.equal(res.numbers.items[0].status, 'error');
  assert.ok(res.changes.items.some(i => i.status === 'phantom' && i.outside));
});

test('a replacement descriptor is rejected before reading text or hashing', (t) => {
  const { root } = setup();
  const placeholder = path.join(root, 'notes.md');
  const other = path.join(root, 'sub', 'x.md');
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (p, ...args) => open(p === placeholder ? other : p, ...args));
  assert.ok(new Workspace(root).load(placeholder).error);
  assert.throws(() => takeSnapshot(new Workspace(root)), /notes\.md/);
});

test('outside status fields match the changelog for all three item types', () => {
  const { root } = setup();
  const name = '//server/share/notes.md';
  const res = run(root, JSON.stringify({
    citations: [{ file: name, line: 1, quote: 'alpha' }],
    numbers: [{ expr: 'lines(' + name + ')', claim: 0 }], files: [name],
  }), { before: takeSnapshot(new Workspace(root)) });
  const cite = res.citations.items[0], num = res.numbers.items[0], file = res.changes.items[0];
  assert.deepEqual([cite.status, cite.detail.reason, num.status, file.status, file.outside, file.exists],
    ['missing_file', 'outside_root', 'error', 'phantom', true, false]);
  assert.match(num.detail.reason, /outside the root folder/);
  const log = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  for (const field of ['outside_root', 'outside: true', 'exists: false']) assert.ok(log.includes(field), field);
});

test('moving the containing directory after open invalidates the handle location', (t) => {
  const { root, base } = setup();
  const dir = path.join(root, 'sub');
  const stat = fs.fstatSync;
  const ws = new Workspace(root);
  t.mock.method(fs, 'fstatSync', (fd, opts) => {
    try { fs.renameSync(dir, path.join(base, 'moved')); }
    catch (e) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      t.skip('filesystem locks the containing directory while its child is open');
    }
    return stat(fd, opts);
  });
  const result = ws.load(path.join(dir, 'x.md'));
  if (!fs.existsSync(dir)) assert.equal(result.error, 'outside_root');
});

test('distinct sibling directories on a case-sensitive volume', (t) => {
  const { root, base } = setup();
  const sibling = path.join(base, 'WS');
  if (fs.existsSync(sibling)) return t.skip('volume folds case');
  fs.mkdirSync(sibling);
  if (!tryLink(sibling, path.join(root, 'alias'), 'junction')) return t.skip('link unavailable');
  fs.writeFileSync(path.join(sibling, 'example.md'), 'fixture');
  assert.equal(new Workspace(root).locate(path.join(root, 'alias', 'example.md')), 'outside');
});
