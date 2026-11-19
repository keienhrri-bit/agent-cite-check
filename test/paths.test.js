// A report is untrusted input. Nothing it names outside --root may be opened, and nothing from
// such a file may reach the output (the "closest line" of an altered excerpt would leak it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { makeWorkspace } from './helpers.js';
import { Workspace } from '../src/workspace.js';
import { runChecks } from '../src/check.js';
import { takeSnapshot, ScanError } from '../src/changes.js';

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
  const before = takeSnapshot(ws);
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
  const read = fs.readFileSync, readSync = fs.readSync;
  t.mock.method(fs, 'readFileSync', (fd, ...args) => {
    assert.equal(typeof fd, 'number');
    return read(fd, ...args);
  });
  t.mock.method(fs, 'readSync', (fd, ...args) => {
    assert.equal(typeof fd, 'number');
    return readSync(fd, ...args);
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
  // openFile opens the canonical path, which can be spelled differently (macOS /var is /private/var, Windows 8.3 names)
  const swapped = new Set([placeholder, fs.realpathSync.native(placeholder)]);
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (p, ...args) => open(swapped.has(p) ? other : p, ...args));
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
  let moved = false, locked = false;
  t.mock.method(fs, 'fstatSync', (fd, opts) => {
    if (!moved && !locked) {
      try { fs.renameSync(dir, path.join(base, 'moved')); moved = true; }
      catch (e) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
        locked = true;
      }
    }
    return stat(fd, opts);
  });
  const result = ws.load(path.join(dir, 'x.md'));
  if (locked) return t.skip('filesystem locks the containing directory while its child is open');
  assert.ok(moved, 'the folder was moved while the file was open');
  assert.equal(result.error, 'outside_root');
});

// Replace a folder inside the root with a junction (a directory symlink elsewhere) to `target`, and undo it.
function swapIn(dir, target) {
  fs.renameSync(dir, dir + '-old');
  fs.symlinkSync(target, dir, 'junction');
}
function swapBack(dir) {
  fs.unlinkSync(dir);
  fs.renameSync(dir + '-old', dir);
}
function canLink(base) {
  const probe = path.join(base, 'probe-link');
  if (!tryLink(base, probe, 'junction')) return false;
  fs.unlinkSync(probe);
  return true;
}

// The checks around the open: a folder on the way to the file is swapped for a link to a folder
// outside the root right before the file is opened, so the descriptor holds the outside file.
// Each case must be refused by the checks made after the open, for both reads and snapshots.
for (const [name, undo] of [['and left in place', false], ['and swapped back before the check', true]]) {
  test(`a folder swapped for an outside link around the open is refused (${name})`, (t) => {
    const { base, root } = setup();
    if (!canLink(base)) return t.skip('cannot create links here');
    const evil = path.join(base, 'evil');
    fs.mkdirSync(evil);
    fs.writeFileSync(path.join(evil, 'x.md'), `${SECRET}\n`);
    const dir = path.join(root, 'sub');
    const file = path.join(dir, 'x.md');
    const real = fs.realpathSync.native(file);
    const reads = { load: (ws) => ws.load(file), snapshot: (ws) => takeSnapshot(ws) };
    for (const [kind, read] of Object.entries(reads)) {
      const ws = new Workspace(root);
      ws.index();
      let swapped = false, restored = false;
      const lstat = fs.lstatSync, fstat = fs.fstatSync;
      const spies = [
        // openFile records the identity of the file it is about to open: swap first, so it matches
        t.mock.method(fs, 'lstatSync', (p, opts) => {
          if (!swapped && p === real && opts?.bigint) { swapped = true; swapIn(dir, evil); }
          return lstat(p, opts);
        }),
        t.mock.method(fs, 'fstatSync', (fd, opts) => {
          if (undo && swapped && !restored) { restored = true; swapBack(dir); }
          return fstat(fd, opts);
        }),
      ];
      let result, error;
      try { result = read(ws); } catch (e) { error = e; }
      for (const s of spies) s.mock.restore();
      assert.ok(swapped, kind);
      assert.equal(restored, undo, kind);
      if (!undo) swapBack(dir);
      assert.ok(!leaks({ result, error: error?.message }), kind);
      if (kind === 'load') assert.equal(result.error, 'outside_root');
      else assert.ok(error instanceof ScanError && /sub\/x\.md/.test(error.message) && !/notes\.md/.test(error.message), String(error));
    }
  });
}

// Swapped in for the open, out for the second path lookup, in again for the identity read after it:
// the identity recorded before the open (an unswapped folder) still tells the objects apart.
test('a folder swapped in, out and in again around the open is refused', (t) => {
  const { base, root } = setup();
  if (!canLink(base)) return t.skip('cannot create links here');
  const evil = path.join(base, 'evil');
  fs.mkdirSync(evil);
  fs.writeFileSync(path.join(evil, 'x.md'), `${SECRET}\n`);
  const dir = path.join(root, 'sub');
  const file = path.join(dir, 'x.md');
  const real = fs.realpathSync.native(file);
  const ws = new Workspace(root);
  const steps = [];
  const open = fs.openSync, fstat = fs.fstatSync, lstat = fs.lstatSync;
  const spies = [
    t.mock.method(fs, 'openSync', (p, ...rest) => {
      if (p === real && !steps.length) { steps.push('in'); swapIn(dir, evil); }
      return open(p, ...rest);
    }),
    t.mock.method(fs, 'fstatSync', (fd, opts) => {
      if (steps.length === 1) { steps.push('out'); swapBack(dir); }
      return fstat(fd, opts);
    }),
    t.mock.method(fs, 'lstatSync', (p, opts) => {
      if (steps.length === 2 && p === real && opts?.bigint) { steps.push('in'); swapIn(dir, evil); }
      return lstat(p, opts);
    }),
  ];
  const result = ws.load(file);
  for (const s of spies) s.mock.restore();
  if (steps.length === 3) swapBack(dir);
  // refused at the first identity comparison; without it, the third step happens and passes
  assert.deepEqual(steps.slice(0, 2), ['in', 'out']);
  assert.equal(result.error, 'outside_root');
  assert.ok(!leaks(result));
});

// 0.1.1 asked a PowerShell (Windows) or Perl (macOS) process where each open file was: about 0.35 s
// per cited file on Windows. The checks now run in this process.
test('reading cited files starts no other process', (t) => {
  const files = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`d${i % 4}/f${i}.md`, `The value for item ${i} is ${i * 7}.\n`]));
  const root = makeWorkspace(files);
  const started = [];
  for (const name of ['execFileSync', 'execSync', 'spawnSync', 'execFile', 'exec', 'spawn', 'fork']) {
    t.mock.method(cp, name, () => { started.push(name); throw new Error('no other process expected'); });
  }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const report = Object.keys(files).map((f, i) => `- ${f}:1 "The value for item ${i} is ${i * 7}."`).join('\n');
  const res = runChecks(report, new Workspace(root));
  const snap = takeSnapshot(new Workspace(root));
  assert.deepEqual(started, []);
  assert.equal(res.citations.passed, 32);
  assert.equal(Object.keys(snap.files).length, 32);
});

test('a folder swapped for an outside link while it is listed is left out of the index', (t) => {
  const { base, root } = setup();
  if (!canLink(base)) return t.skip('cannot create links here');
  const dir = path.join(root, 'sub');
  const readdir = fs.readdirSync;
  let swapped = false;
  t.mock.method(fs, 'readdirSync', function (p, ...rest) {
    if (!swapped && path.basename(String(p)) === 'sub') { swapped = true; swapIn(dir, path.join(base, 'outside')); }
    return readdir.call(this, p, ...rest);
  });
  const ws = new Workspace(root);
  const idx = ws.index();
  assert.ok(swapped);
  assert.deepEqual(idx, ['notes.md']);
  assert.deepEqual(ws.scanProblems.map((p) => p.path), ['sub']);
});

test('a root swapped for an outside link after the start is not listed', (t) => {
  const { base, root } = setup();
  if (!canLink(base)) return t.skip('cannot create links here');
  const ws = new Workspace(root);
  swapIn(root, path.join(base, 'outside'));
  assert.deepEqual(ws.index(), []);
  assert.deepEqual(ws.scanProblems.map((p) => p.path), ['.']);
});

test('a link target is not recorded from a folder swapped in while it is read', (t) => {
  const { base, root } = setup();
  if (!canLink(base)) return t.skip('cannot create links here');
  const docs = path.join(root, 'docs');
  const evil = path.join(base, 'evil');
  const hidden = path.join(base, 'hidden-target-name');
  for (const d of [docs, evil, hidden]) fs.mkdirSync(d);
  tryLink(path.join(root, 'sub'), path.join(docs, 'j'), 'junction');
  tryLink(hidden, path.join(evil, 'j'), 'junction');
  const ws = new Workspace(root);
  const readlink = fs.readlinkSync;
  let swapped = false;
  t.mock.method(fs, 'readlinkSync', function (p, ...rest) {
    if (!swapped && path.basename(String(p)) === 'j') { swapped = true; swapIn(docs, evil); }
    return readlink.call(this, p, ...rest);
  });
  let snap = null, error = null;
  try { snap = takeSnapshot(ws); } catch (e) { error = e; }
  assert.ok(swapped);
  assert.ok(!JSON.stringify(snap ?? {}).includes('hidden-target-name'));
  assert.ok(error instanceof ScanError && /docs\/j/.test(error.message), String(error));
});

test('a link inside an aliased root may point at the canonical absolute path', (t) => {
  const { base, root } = setup();
  const alias = path.join(base, 'alias');
  // macOS: /var is /private/var. Here the root is reached through a junction (a symlink elsewhere).
  if (!tryLink(root, alias, 'junction')) return t.skip('cannot create links here');
  // a junction stores an absolute target: the canonical spelling of a folder inside the root
  tryLink(fs.realpathSync.native(path.join(root, 'sub')), path.join(root, 'canon'), 'junction');
  const res = runChecks('- canon/x.md:1 "x"', new Workspace(alias), { minQuote: 1 });
  assert.equal(res.citations.items[0].status, 'ok');
  assert.equal(new Workspace(alias).locate(path.join(fs.realpathSync.native(root), 'notes.md')), 'inside');
});

test('a path that cannot be looked up fails its own item, not the whole check', (t) => {
  const { root } = setup();
  fs.mkdirSync(path.join(root, 'locked'));
  fs.writeFileSync(path.join(root, 'locked', 'a.md'), 'alpha beta\n');
  const opts = { ignore: ['locked/**'] };
  const before = takeSnapshot(new Workspace(root, opts));
  // like a folder without search permission: its entries cannot be looked up
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', function (p, ...rest) {
    if (path.basename(path.dirname(String(p))) === 'locked') throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return lstat.call(this, p, ...rest);
  });
  const report = ['- locked/a.md:1 "alpha beta"', '- notes.md:1 "The pump was serviced on 12 May."', '`lines(locked/a.md) = 1`', '[+] locked/b.md'].join('\n');
  const res = runChecks(report, new Workspace(root, opts), { before });
  assert.deepEqual(res.citations.items.map((i) => [i.status, i.detail?.reason]), [['unreadable', 'unreadable'], ['ok', undefined]]);
  assert.equal(res.numbers.items[0].status, 'error');
  assert.match(res.numbers.items[0].detail.reason, /cannot read/);
  assert.deepEqual(res.changes.items.map((i) => [i.path, i.status]), [['locked/b.md', 'phantom']]);
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
