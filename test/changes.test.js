import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeWorkspace } from './helpers.js';
import { Workspace } from '../src/workspace.js';
import { takeSnapshot } from '../src/changes.js';
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
