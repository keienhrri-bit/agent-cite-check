// Command line entry.
import fs from 'node:fs';
import path from 'node:path';
import { Workspace } from './workspace.js';
import { runChecks, readJson, VERSION, DEFAULTS } from './check.js';
import { takeSnapshot } from './changes.js';
import { summarize } from './summary.js';

const HELP = `agent-cite-check ${VERSION}
Check an agent's report against local files: citations, numbers, file changes. No model calls.

Usage:
  agent-cite-check <report.md|report.json|-> [options]
  agent-cite-check snapshot [--root DIR] [-o before.json]

Where to look:
  --root DIR            workspace the citations point into (default: current directory)
  --ignore GLOB         skip files when indexing/snapshotting (repeatable)

Citations:
  --tolerance N         accept the excerpt up to N lines away from the cited line (default ${DEFAULTS.tolerance})
  --min-quote N         excerpts shorter than N characters (after normalizing) fail (default ${DEFAULTS.minQuote})
  --allow-no-quote      a citation without an excerpt passes if the file and line exist
  --sample N|P%         check only a random sample of citations (e.g. 20 or 25%)
  --seed N              seed for --sample (default 1)

File changes:
  --before FILE         snapshot taken before the job (see "snapshot"); compare with the workspace now
  --git                 use "git status" in --root instead of a snapshot
  --writable GLOB       only these paths may change (repeatable); anything else is "forbidden"
  --protect GLOB        these paths must not change (repeatable)

Output and gate:
  --json FILE           write the full result as JSON
  --format text|json    what to print on stdout (default text)
  --lang zh|en          summary language (default: zh if the report contains Chinese, else en)
  --max-failures N      pass if at most N checks fail (default 0)
  --allow-empty         pass when the report contains nothing checkable

Exit codes: 0 pass, 1 checks failed, 2 usage or read error.`;

const REPEAT = new Set(['ignore', 'writable', 'protect']);
const FLAGS = new Set(['allow-no-quote', 'allow-empty', 'git', 'help', 'version']);

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { opts.help = true; continue; }
    if (a === '-o') { opts.out = argv[++i]; continue; }
    if (a.startsWith('--')) {
      let [k, v] = a.slice(2).split(/=(.*)/s);
      if (FLAGS.has(k)) { opts[k] = true; continue; }
      if (v === undefined) {
        v = argv[++i];
        if (v === undefined) throw new UsageError(`--${k} needs a value`);
      }
      if (REPEAT.has(k)) (opts[k] ??= []).push(v);
      else opts[k] = v;
    } else opts._.push(a);
  }
  return opts;
}

class UsageError extends Error {}

const intOpt = (v, name) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`--${name} must be a non-negative integer`);
  return n;
};

export function main(argv, io = { out: process.stdout, err: process.stderr, stdin: 0 }) {
  try {
    const o = parseArgs(argv);
    if (o.help || (!o._.length && !o.version)) { io.out.write(HELP + '\n'); return o.help ? 0 : 2; }
    if (o.version) { io.out.write(VERSION + '\n'); return 0; }

    const root = path.resolve(o.root ?? '.');
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UsageError(`--root is not a directory: ${root}`);
    const ws = new Workspace(root, { ignore: o.ignore ?? [] });

    if (o._[0] === 'snapshot') {
      if (o._[1]) throw new UsageError('use --root DIR to pick the folder to snapshot');
      const snap = takeSnapshot(ws);
      const json = JSON.stringify(snap, null, 1);
      if (o.out) {
        fs.writeFileSync(o.out, json);
        io.out.write(`snapshot: ${Object.keys(snap.files).length} files -> ${o.out}\n`);
      } else io.out.write(json + '\n');
      return 0;
    }

    const reportArg = o._[0];
    let text, reportName, reportAbs = null;
    if (reportArg === '-') {
      text = fs.readFileSync(io.stdin, 'utf8');
      reportName = 'stdin';
    } else {
      reportAbs = path.resolve(reportArg);
      try { text = fs.readFileSync(reportAbs, 'utf8'); } catch { throw new UsageError(`cannot read report: ${reportArg}`); }
      reportName = path.basename(reportArg);
    }

    let before = null;
    if (o.before) {
      try { before = readJson(o.before); } catch { throw new UsageError(`cannot read snapshot: ${o.before}`); }
    }
    const exclude = [reportAbs, o.before && path.resolve(o.before), o.json && path.resolve(o.json)].filter(Boolean);
    const res = runChecks(text, ws, {
      tolerance: intOpt(o.tolerance, 'tolerance') ?? DEFAULTS.tolerance,
      minQuote: intOpt(o['min-quote'], 'min-quote') ?? DEFAULTS.minQuote,
      maxFailures: intOpt(o['max-failures'], 'max-failures') ?? DEFAULTS.maxFailures,
      allowNoQuote: !!o['allow-no-quote'],
      allowEmpty: !!o['allow-empty'],
      sample: o.sample ?? null,
      seed: o.seed ?? 1,
      before,
      git: !!o.git,
      writable: o.writable ?? [],
      protect: o.protect ?? [],
      exclude,
      reportDir: reportAbs ? path.dirname(reportAbs) : null,
    }, reportName);

    const lang = o.lang ?? (/[一-鿿]/.test(text) ? 'zh' : 'en');
    res.summary = summarize(res, lang);
    if (o.json) fs.writeFileSync(o.json, JSON.stringify(res, null, 2));
    io.out.write((o.format === 'json' ? JSON.stringify(res, null, 2) : res.summary) + '\n');
    return res.verdict === 'pass' ? 0 : 1;
  } catch (e) {
    if (e instanceof UsageError) { io.err.write(`agent-cite-check: ${e.message}\n`); return 2; }
    if (e && e.code === 'ENOENT') { io.err.write(`agent-cite-check: ${e.message}\n`); return 2; }
    if (e && /git/.test(String(e.message)) && e.status) { io.err.write(`agent-cite-check: git failed: ${String(e.stderr || e.message).trim()}\n`); return 2; }
    io.err.write(`agent-cite-check: ${e && e.stack ? e.stack : e}\n`);
    return 2;
  }
}
