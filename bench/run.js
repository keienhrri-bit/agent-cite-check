// Run the checker over the synthetic benchmark and report detection and false-positive rates.
// Run: node bench/generate.js && node bench/run.js
// `node bench/run.js --tolerance 0` reruns with another line tolerance and prints the summary
// without touching bench/RESULTS.md (which always holds the default-options run).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '../src/workspace.js';
import { runChecks } from '../src/check.js';
import { takeSnapshot } from '../src/changes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const labels = JSON.parse(fs.readFileSync(path.join(DATA, 'labels.json'), 'utf8'));
const ws = new Workspace(path.join(DATA, 'workspace'));
const tolArg = process.argv.indexOf('--tolerance');
const OPTS = tolArg === -1 ? {} : { tolerance: Number(process.argv[tolArg + 1]) };
if (tolArg !== -1 && !Number.isInteger(OPTS.tolerance)) throw new Error('--tolerance needs a whole number');

const stats = new Map(); // category -> { label, n, flagged, statuses }
const misses = [];
function record(label, category, flagged, status, where) {
  const s = stats.get(category) ?? { label, n: 0, flagged: 0, statuses: {} };
  s.n++;
  if (flagged) s.flagged++;
  s.statuses[status] = (s.statuses[status] ?? 0) + 1;
  stats.set(category, s);
  if ((label === 'bad') !== flagged) misses.push(`${where} [${category}] -> ${status}`);
}

// ---- citations and numbers ----
for (const rep of labels.reports) {
  const text = fs.readFileSync(path.join(DATA, 'reports', rep.file), 'utf8');
  const res = runChecks(text, ws, OPTS, rep.file);
  if (res.citations.items.length !== rep.citations.length) throw new Error(`${rep.file}: parsed ${res.citations.items.length} citations, expected ${rep.citations.length}`);
  if (res.numbers.items.length !== rep.numbers.length) throw new Error(`${rep.file}: parsed ${res.numbers.items.length} numbers, expected ${rep.numbers.length}`);
  rep.citations.forEach((l, i) => {
    const it = res.citations.items[i];
    record(l.label, l.category, !it.pass, it.status, `${rep.file}#${it.id}`);
  });
  rep.numbers.forEach((l, i) => {
    const it = res.numbers.items[i];
    record(l.label, l.category, !it.pass, it.status, `${rep.file} ${it.expr}`);
  });
}

// ---- file changes ----
function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}
const R = rng(42);
const OPS = [
  ['added_reported', 'good'], ['modified_reported', 'good'], ['deleted_reported', 'good'],
  ['added_unreported', 'bad'], ['modified_unreported', 'bad'], ['same_size_edit_unreported', 'bad'],
  ['deleted_unreported', 'bad'], ['phantom_reported', 'bad'], ['protected_edit_reported', 'bad'],
];
const SCENARIOS = 30;
for (let s = 0; s < SCENARIOS; s++) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-bench-'));
  fs.cpSync(path.join(DATA, 'workspace'), root, { recursive: true });
  fs.mkdirSync(path.join(root, 'out'));
  // more untouched files than one scenario can pick (5 ops), so take() always finds a free one
  fs.mkdirSync(path.join(root, 'notes'));
  for (let k = 0; k < 8; k++) fs.writeFileSync(path.join(root, 'notes', `note_${k}.md`), `# Note ${k}\n\nItem 1: synthetic filler line ${k}.\n`);
  const w = new Workspace(root);
  const before = takeSnapshot(w);
  const pool = w.index().filter((p) => p.endsWith('.md'));
  const used = new Set();
  const take = () => {
    if (used.size >= pool.length) throw new Error(`scenario ${s + 1}: no untouched file left to change`);
    let p; do p = R.pick(pool); while (used.has(p)); used.add(p); return p;
  };
  const report = [];
  const truth = []; // { path, label, category }
  const ops = Array.from({ length: 5 }, () => R.pick(OPS));
  ops.forEach(([op, label], k) => {
    let p;
    switch (op) {
      case 'added_reported': p = `out/new_${k}.md`; fs.writeFileSync(path.join(root, p), 'x\n'); report.push(`[+] ${p}`); break;
      case 'added_unreported': p = `out/extra_${k}.md`; fs.writeFileSync(path.join(root, p), 'x\n'); break;
      case 'modified_reported': p = take(); fs.appendFileSync(path.join(root, p), 'edit\n'); report.push(`[~] ${p}`); break;
      case 'modified_unreported': p = take(); fs.appendFileSync(path.join(root, p), 'edit\n'); break;
      case 'same_size_edit_unreported': {
        p = take();
        const abs = path.join(root, p);
        const b = fs.readFileSync(abs);
        const i = b.indexOf(0x31); // first "1" digit
        b[i >= 0 ? i : 0] = i >= 0 ? 0x37 : b[0] ^ 1; // same byte length, different content
        fs.writeFileSync(abs, b);
        break;
      }
      case 'deleted_reported': p = take(); fs.unlinkSync(path.join(root, p)); report.push(`[-] ${p}`); break;
      case 'deleted_unreported': p = take(); fs.unlinkSync(path.join(root, p)); break;
      case 'phantom_reported': p = `out/promised_${k}.md`; report.push(`[+] ${p}`); break;
      case 'protected_edit_reported': p = take(); fs.appendFileSync(path.join(root, p), 'edit\n'); report.push(`[~] ${p}`); break;
    }
    truth.push({ path: p, label, category: `change_${op}` });
  });
  const protect = truth.filter((t) => t.category === 'change_protected_edit_reported').map((t) => t.path);
  const res = runChecks(report.join('\n'), new Workspace(root), { before, protect, allowEmpty: true });
  const byPath = new Map(res.changes.items.map((i) => [i.path, i]));
  for (const t of truth) {
    const it = byPath.get(t.path);
    const flagged = it ? !['ok', 'kind_differs'].includes(it.status) : false;
    record(t.label, t.category, flagged, it ? it.status : 'not_listed', `scenario ${s + 1} ${t.path}`);
  }
  // anything flagged that we did not plant is a false positive
  for (const it of res.changes.items) {
    if (!truth.some((t) => t.path === it.path) && !['ok', 'kind_differs'].includes(it.status)) record('good', 'change_untouched_file', true, it.status, `scenario ${s + 1} ${it.path}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- report ----
const rows = [...stats.entries()].sort((a, b) => (a[1].label === b[1].label ? a[0].localeCompare(b[0]) : a[1].label === 'bad' ? -1 : 1));
const sum = (label) => rows.filter(([, s]) => s.label === label).reduce((acc, [, s]) => [acc[0] + s.n, acc[1] + s.flagged], [0, 0]);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '–');
const lines = [];
lines.push('| Category | Expected | Cases | Flagged | Rate | Statuses |');
lines.push('|---|---|---:|---:|---:|---|');
for (const [cat, s] of rows) {
  const st = Object.entries(s.statuses).map(([k, v]) => `${k} ${v}`).join(', ');
  lines.push(`| ${cat} | ${s.label === 'bad' ? 'flag' : 'pass'} | ${s.n} | ${s.flagged} | ${pct(s.flagged, s.n)} | ${st} |`);
}
const [badN, badF] = sum('bad');
const [goodN, goodF] = sum('good');
const hard = stats.get('neighbor_line');
const [badNoHardN, badNoHardF] = hard ? [badN - hard.n, badF - hard.flagged] : [badN, badF];
const summary = [
  `Planted problems: ${badN}, flagged ${badF} (${pct(badF, badN)}).`,
  hard ? `Without the known blind spot "neighbor_line" (verbatim text of a line within the tolerance): ${badNoHardN}, flagged ${badNoHardF} (${pct(badNoHardF, badNoHardN)}).` : '',
  `Benign variants: ${goodN}, wrongly flagged ${goodF} (${pct(goodF, goodN)}).`,
].filter(Boolean);
const out = [
  '# Benchmark results',
  '',
  `Generated by \`node bench/generate.js\` (seed ${labels.seed}), run by \`node bench/run.js\` with default options (tolerance ${labels.tolerance} lines, min excerpt 5 chars). Synthetic data written by the tool's author; labels are set by the generator from the mutation it applied.`,
  '',
  ...summary.map((s) => `- ${s}`),
  '',
  ...lines,
  '',
  misses.length ? `Misclassified (${misses.length}):\n\n${misses.map((m) => `- ${m}`).join('\n')}` : 'Misclassified: none.',
  '',
].join('\n');
if (tolArg !== -1) {
  console.log(`tolerance ${OPTS.tolerance} lines (bench/RESULTS.md not written)`);
  console.log(summary.join('\n'));
  console.log(lines.join('\n'));
} else {
  fs.writeFileSync(path.join(HERE, 'RESULTS.md'), out);
  console.log(summary.join('\n'));
  console.log(`details: ${path.relative(process.cwd(), path.join(HERE, 'RESULTS.md'))}`);
}
