import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from '../src/cli.js';
import { makeWorkspace } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const quick = path.join(here, '..', 'examples', 'quickstart');

function run(args) {
  let out = '', err = '';
  const code = main(args, { out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}

test('quickstart example fails with the planted problems', () => {
  const r = run([path.join(quick, 'report.md'), '--root', path.join(quick, 'workspace')]);
  assert.equal(r.code, 1);
  assert.match(r.out, /Citations 5: 2 match, 3 do not/);
  assert.match(r.out, /claimed 13, recomputed 12/);
});

// The Claude Code plugin puts bin/ on PATH. Plain `agent-cite-check` must reach Node through the
// launchers: the .cmd on Windows (else Windows Script Host opens the .js), the sh script elsewhere.
test('PATH launchers run the CLI and pass the exit code through', () => {
  const bin = path.join(here, '..', 'bin');
  const args = [path.join(quick, 'report.md'), '--root', path.join(quick, 'workspace')];
  const launch = (extra) => (process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/c', path.join(bin, 'agent-cite-check.cmd'), ...extra], { encoding: 'utf8' })
    : spawnSync('sh', [path.join(bin, 'agent-cite-check'), ...extra], { encoding: 'utf8' }));
  const v = launch(['--version']);
  assert.equal(v.status, 0);
  assert.equal(v.stdout.trim(), JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version);
  const r = launch(args);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL \(4 problems\)/);
});

test('exit 0 on a clean report, JSON output', () => {
  const root = makeWorkspace({ 'n.md': 'alpha beta gamma\n' });
  const rep = path.join(root, 'r.md');
  fs.writeFileSync(rep, 'n.md:1 "alpha beta gamma"\n');
  const r = run([rep, '--root', root, '--format', 'json']);
  assert.equal(r.code, 0);
  const res = JSON.parse(r.out);
  assert.equal(res.verdict, 'pass');
  assert.equal(res.citations.passed, 1);
});

test('Chinese summary when the report is Chinese', () => {
  const root = makeWorkspace({ 'n.md': '第一行内容在这里\n' });
  const rep = path.join(root, 'r.md');
  fs.writeFileSync(rep, 'n.md:1「第一行内容不在这里」\n');
  const r = run([rep, '--root', root]);
  assert.equal(r.code, 1);
  assert.match(r.out, /不通过/);
});

test('exit 2 on usage errors', () => {
  assert.equal(run(['no-such-report.md']).code, 2);
  assert.equal(run(['x.md', '--root', 'no/such/dir']).code, 2);
  assert.equal(run(['x.md', '--tolerance', '-1']).code, 2);
});

test('snapshot command writes a file', () => {
  const root = makeWorkspace({ 'a.md': 'a\n' });
  const out = path.join(root, '..', path.basename(root) + '-snap.json');
  const r = run(['snapshot', '--root', root, '-o', out]);
  assert.equal(r.code, 0);
  assert.ok(JSON.parse(fs.readFileSync(out, 'utf8')).files['a.md'].sha256);
});

// --- fixes from the 0.1.1 code review ---

test('--before must be a snapshot; null or another JSON does not switch the change check off', () => {
  const root = makeWorkspace({ 'n.md': 'alpha beta gamma\n' });
  const rep = path.join(root, 'r.md');
  fs.writeFileSync(rep, 'n.md:1 "alpha beta gamma"\n');
  const snap = (body) => {
    const f = path.join(root, '..', `${path.basename(root)}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(f, body);
    return f;
  };
  for (const body of ['null', 'false', '0', '{}', '[]', '{"files":{}}', '{"tool":"agent-cite-check","kind":"snapshot","files":{"a":1}}']) {
    const r = run([rep, '--root', root, '--before', snap(body)]);
    assert.equal(r.code, 2, body);
    assert.match(r.err, /not a snapshot/, body);
  }
  // a snapshot written by 0.1.0 (size and sha256 only) is still accepted
  const old = snap(JSON.stringify({ tool: 'agent-cite-check', kind: 'snapshot', created: 'x', files: { 'n.md': { size: 17, sha256: null } } }));
  assert.equal(run([rep, '--root', root, '--before', old]).code, 0);
});

test('unknown or misplaced options are usage errors, not ignored', () => {
  const root = makeWorkspace({ 'n.md': 'alpha beta gamma\n' });
  const rep = path.join(root, 'r.md');
  fs.writeFileSync(rep, 'n.md:1 "alpha beta gamma"\n');
  const cases = [
    [[rep, '--root', root, '--writtable', 'out/**'], /unknown option --writtable/],
    [[rep, '--root', root, '-x'], /unknown option -x/],
    [[rep, '--root', root, '-o', 'before.json'], /only for "snapshot".*--before/],
    [[rep, '--root', root, '--format', 'xml'], /--format/],
    [[rep, '--root', root, '--lang', 'fr'], /--lang/],
    [[rep, '--root', root, '--sample', 'some'], /--sample/],
    [[rep, rep, '--root', root], /one report at a time/],
    [[rep, '--root', root, '--git=yes'], /takes no value/],
    [['snapshot', '--root', root, '--before', 'x.json'], /not an option of "snapshot"/],
  ];
  for (const [args, msg] of cases) {
    const r = run(args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, msg, args.join(' '));
  }
  assert.equal(run([rep, '--root', root]).code, 0);
});
