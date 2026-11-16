// File-change check in one command: copy the quickstart workspace to a temp folder, take a snapshot,
// let a pretend agent do its work (plus one edit it does not report), then check its report.
// Run from the repository root: node examples/changes/demo.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', '..', 'bin', 'agent-cite-check.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-demo-'));
const work = path.join(tmp, 'workspace');
const before = path.join(tmp, 'before.json');
fs.cpSync(path.join(here, '..', 'quickstart', 'workspace'), work, { recursive: true });

const show = (s) => s.split(tmp).join('<tmp>').split(path.resolve(here, '..', '..') + path.sep).join('');

function run(args) {
  console.log(show(`$ agent-cite-check ${args.join(' ')}`));
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  process.stdout.write(show(r.stdout + r.stderr));
  return r.status;
}

try {
  // 1. before the job
  run(['snapshot', '--root', work, '-o', before]);

  // 2. the pretend agent: writes summary.md as reported, and quietly edits notes.md
  console.log('\n(agent works: creates summary.md, appends a line to notes.md, does not touch samples.csv)\n');
  fs.writeFileSync(path.join(work, 'summary.md'), 'Day 2: station 4 skipped because of rain.\n');
  fs.appendFileSync(path.join(work, 'notes.md'), 'Corrected by the agent.\n');

  // 3. after the job: only summary.md was allowed to change
  const code = run([path.join(here, 'report.md'), '--root', work, '--before', before, '--writable', 'summary.md']);
  console.log(`\nexit code: ${code}`);
  process.exitCode = code;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
