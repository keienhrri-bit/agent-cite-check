import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeWorkspace } from './helpers.js';
import { Workspace } from '../src/workspace.js';
import { takeSnapshot, ScanError } from '../src/changes.js';
import { runChecks } from '../src/check.js';

const byPath = (res) => Object.fromEntries(res.changes.items.map((i) => [i.path, i.status]));

test('snapshot diff vs. reported files', () => {
  const root = makeWorkspace({ 'src/a.md': 'a\n', 'src/b.md': 'b\n', 'keep.md': 'k\n', 'gone.md': 'g\n' });
  const before = takeSnapshot(new Workspace(root));
  fs.writeFileSync(path.join(root, 'out.md'), 'new\n');          // reported
  fs.writeFileSync(path.join(root, 'src/a.md'), 'changed\n');    // NOT reported
  fs.unlinkSync(path.join(root, 'gone.md'));                     // reported
  fs.writeFileSync(path.join(root, 'keep.md'), 'k2\n');          // reported as added, really modified
  const report = ['[+] out.md', '[-] gone.md', '[+] keep.md', '[+] ghost.md', '[~] src/b.md'].join('\n');
  const res = runChecks(report, new Workspace(root), { before, allowEmpty: true });
  assert.deepEqual(byPath(res), {
    'out.md': 'ok',
    'src/a.md': 'unreported',
    'gone.md': 'ok',
    'keep.md': 'kind_differs',
    'ghost.md': 'phantom',
    'src/b.md': 'phantom',
  });
  assert.equal(res.changes.failed, 3);
  assert.equal(res.verdict, 'fail');
});

test('writable and protected areas', () => {
  const root = makeWorkspace({ 'docs/src.md': 's\n' });
  const before = takeSnapshot(new Workspace(root));
  fs.mkdirSync(path.join(root, 'out'));
  fs.writeFileSync(path.join(root, 'out/r.md'), 'r\n');
  fs.writeFileSync(path.join(root, 'docs/src.md'), 'edited\n');
  const res = runChecks('[+] out/r.md\n[~] docs/src.md', new Workspace(root), { before, writable: ['out/**'] });
  assert.deepEqual(byPath(res), { 'out/r.md': 'ok', 'docs/src.md': 'forbidden' });
  const res2 = runChecks('[+] out/r.md\n[~] docs/src.md', new Workspace(root), { before, protect: ['docs/**'] });
  assert.equal(byPath(res2)['docs/src.md'], 'forbidden');
});

test('report and snapshot files are excluded; absolute reported paths work', () => {
  const root = makeWorkspace({ 'a.md': 'a\n' });
  const before = takeSnapshot(new Workspace(root));
  const reportPath = path.join(root, 'report.md');
  fs.writeFileSync(path.join(root, 'b.md'), 'b\n');
  fs.writeFileSync(reportPath, `[+] ${path.join(root, 'b.md')}\n`);
  const res = runChecks(fs.readFileSync(reportPath, 'utf8'), new Workspace(root), { before, exclude: [reportPath] });
  assert.deepEqual(byPath(res), { 'b.md': 'ok' });
  assert.equal(res.verdict, 'pass');
});

let hasGit = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { hasGit = false; }

test('git mode', { skip: !hasGit }, () => {
  const root = makeWorkspace({ 'a.md': 'a\n', 'b.md': 'b\n' });
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init');
  fs.writeFileSync(path.join(root, 'a.md'), 'a2\n');
  fs.writeFileSync(path.join(root, 'c.md'), 'c\n');
  const res = runChecks('[~] a.md', new Workspace(root), { git: true });
  assert.deepEqual(byPath(res), { 'a.md': 'ok', 'c.md': 'unreported' });
});

// Windows: the root may be spelled with 8.3 short names (C:\Users\RUNNER~1\...) while git reports
// the long top-level path. Changes must still be matched.
test('git mode with a root spelled differently from git\'s top level (Windows short names)', { skip: !hasGit || process.platform !== 'win32' }, (t) => {
  const base = makeWorkspace({});
  const long = path.join(base, 'a long folder name');
  fs.mkdirSync(path.join(long, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(long, 'sub', 'a.md'), 'a\n');
  const git = (...args) => execFileSync('git', ['-C', long, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const short = execFileSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${long}") do @echo %~sI"`], { windowsVerbatimArguments: true, encoding: 'utf8' }).trim();
  if (short.toLowerCase() === long.toLowerCase()) return t.skip('no 8.3 short names on this volume');
  fs.writeFileSync(path.join(long, 'sub', 'a.md'), 'a2\n');
  fs.writeFileSync(path.join(long, 'sub', 'c.md'), 'c\n');
  const res = runChecks('[~] a.md', new Workspace(path.join(short, 'sub')), { git: true });
  assert.deepEqual(byPath(res), { 'a.md': 'ok', 'c.md': 'unreported' });
});

// --- fixes from the 0.1.1 code review ---

test('git mode: a staged rename is a deletion of the old path plus an addition', { skip: !hasGit }, () => {
  const root = makeWorkspace({ 'docs/important.md': 'keep me\n', 'readme.md': 'r\n' });
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'init');
  fs.mkdirSync(path.join(root, 'out'));
  git('mv', 'docs/important.md', 'out/important.md');
  const res = runChecks('[+] out/important.md', new Workspace(root), { git: true, writable: ['out/**'], protect: ['docs/**'] });
  assert.deepEqual(byPath(res), { 'out/important.md': 'ok', 'docs/important.md': 'forbidden' });
  assert.equal(res.verdict, 'fail');
});

function tryLink(target, link, type) {
  try { fs.symlinkSync(target, link, type); return true; } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') return false;
    throw e;
  }
}

test('snapshots record symbolic links: new links and changed targets are changes', (t) => {
  const root = makeWorkspace({ 'docs/a.md': 'a\n', 'one.md': '1\n', 'two.md': '2\n' });
  if (!tryLink(path.join(root, 'one.md'), path.join(root, 'docs', 'old-link'), 'file')) return t.skip('cannot create symbolic links here');
  const before = takeSnapshot(new Workspace(root));
  assert.equal(typeof before.files['docs/old-link'].link, 'string');
  fs.unlinkSync(path.join(root, 'docs', 'old-link'));
  tryLink(path.join(root, 'two.md'), path.join(root, 'docs', 'old-link'), 'file'); // same name, new target
  tryLink(path.join(root, 'one.md'), path.join(root, 'docs', 'new-link'), 'file');
  const res = runChecks('', new Workspace(root), { before, protect: ['docs/**'], allowEmpty: true });
  assert.deepEqual(byPath(res), { 'docs/old-link': 'forbidden', 'docs/new-link': 'forbidden' });
  assert.deepEqual(res.changes.items.map((i) => i.change).sort(), ['added', 'modified']);
});

test('a snapshot of a folder that cannot be fully scanned is an error, not a partial result', (t) => {
  const root = makeWorkspace({ 'a.md': 'a\n', 'b.md': 'b\n', 'locked/c.md': 'c\n' });
  // too many files
  assert.throws(() => takeSnapshot(new Workspace(root, { maxFiles: 2 })), (e) => e instanceof ScanError && /more than 2 files/.test(e.message));
  // a folder that cannot be read
  const readdir = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', function (dir, ...rest) {
    if (String(dir).endsWith('locked')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return readdir.call(this, dir, ...rest);
  });
  assert.throws(() => takeSnapshot(new Workspace(root)), (e) => e instanceof ScanError && /locked \(EACCES\)/.test(e.message));
  // checking citations only does not need a complete scan
  const res = runChecks('- a.md:1 "a a a a a"', new Workspace(root), { minQuote: 1 });
  assert.equal(res.citations.items.length, 1);
  t.mock.restoreAll();
  // a file that cannot be read while hashing
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function (p, ...rest) {
    if (String(p).endsWith('b.md')) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return read.call(this, p, ...rest);
  });
  assert.throws(() => takeSnapshot(new Workspace(root)), (e) => e instanceof ScanError && /b\.md \(EBUSY\)/.test(e.message));
});

test('--ignore of one file does not drop the rest of its folder', () => {
  const root = makeWorkspace({ 'docs/x': 'x\n', 'docs/important.md': 'i\n', 'dist/a.js': 'a\n' });
  const ws = new Workspace(root, { ignore: ['docs/x', 'dist/**'] });
  assert.deepEqual(ws.index(), ['docs/important.md']);
  const before = takeSnapshot(ws);
  fs.writeFileSync(path.join(root, 'docs/important.md'), 'edited\n');
  const res = runChecks('', new Workspace(root, { ignore: ['docs/x', 'dist/**'] }), { before, allowEmpty: true });
  assert.deepEqual(byPath(res), { 'docs/important.md': 'unreported' });
});
