// Command line entry.
import fs from 'node:fs';
import path from 'node:path';
import { Workspace } from './workspace.js';
import { runChecks, readJson, VERSION, DEFAULTS } from './check.js';
import { takeSnapshot, isSnapshot, ScanError } from './changes.js';
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
const VALUED = new Set(['out', 'root', 'ignore', 'tolerance', 'min-quote', 'sample', 'seed', 'before', 'writable', 'protect', 'json', 'format', 'lang', 'max-failures']);
// options that only make sense for `snapshot`, and those that only make sense for a check
const SNAPSHOT_ONLY = new Set(['out']);
const CHECK_ONLY = new Set(['tolerance', 'min-quote', 'allow-no-quote', 'sample', 'seed', 'before', 'git', 'writable', 'protect', 'json', 'format', 'lang', 'max-failures', 'allow-empty']);

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { opts.help = true; continue; }
    if (a === '-o') {
      opts.out = argv[++i];
      if (!opts.out || /^-(?:-|[a-z])/i.test(opts.out)) throw new UsageError('-o needs a value');
      continue;
    }
    if (a.startsWith('--')) {
      let [k, v] = a.slice(2).split(/=(.*)/s);
      if (FLAGS.has(k)) {
        if (v !== undefined) throw new UsageError(`--${k} takes no value`);
        opts[k] = true;
        continue;
      }
      // a misspelled option (--writtable) must not be ignored: it would silently drop a restriction
      if (!VALUED.has(k)) throw new UsageError(`unknown option --${k} (see --help)`);
      if (v === undefined) {
        v = argv[++i];
        if (!v || /^-(?:-|[a-z])/i.test(v)) throw new UsageError(`--${k} needs a value`);
      }
      if (REPEAT.has(k)) (opts[k] ??= []).push(v);
      else opts[k] = v;
    } else if (a.startsWith('-') && a !== '-') {
      throw new UsageError(`unknown option ${a} (see --help)`);
    } else opts._.push(a);
  }
  return opts;
}

function checkArgs(o) {
  const snapshot = o._[0] === 'snapshot';
  for (const k of Object.keys(o)) {
    if (snapshot && CHECK_ONLY.has(k)) throw new UsageError(`--${k} is not an option of "snapshot"`);
    if (!snapshot && SNAPSHOT_ONLY.has(k)) throw new UsageError('-o is only for "snapshot"; pass the snapshot to a check with --before FILE');
  }
  if (snapshot) {
    if (o._.length > 1) throw new UsageError('use --root DIR to pick the folder to snapshot');
    return;
  }
  if (o._.length > 1) throw new UsageError(`one report at a time; unexpected argument: ${o._[1]}`);
  if (o.format !== undefined && !['text', 'json'].includes(o.format)) throw new UsageError('--format must be text or json');
  if (o.lang !== undefined && !['zh', 'en'].includes(o.lang)) throw new UsageError('--lang must be zh or en');
  if (o.sample !== undefined && !(/^\d+$/.test(o.sample) && Number.isSafeInteger(Number(o.sample)) || /^\d+(?:\.\d+)?%$/.test(o.sample) && parseFloat(o.sample) <= 100)) throw new UsageError('--sample must be a count (20) or a share (25%)');
  if (o.before !== undefined && o.git) throw new UsageError('use either --before or --git, not both');
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
    checkArgs(o);

    const root = path.resolve(o.root ?? '.');
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UsageError(`--root is not a directory: ${root}`);
    const ws = new Workspace(root, { ignore: o.ignore ?? [] });

    if (o._[0] === 'snapshot') {
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
    if (o.before !== undefined) {
      try { before = readJson(o.before); } catch { throw new UsageError(`cannot read snapshot: ${o.before}`); }
      // anything else (null, {}, another tool's JSON) would quietly turn the change check off or empty
      if (!isSnapshot(before)) throw new UsageError(`not a snapshot written by "agent-cite-check snapshot": ${o.before}`);
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
    if (e instanceof UsageError || e instanceof ScanError) { io.err.write(`agent-cite-check: ${e.message}\n`); return 2; }
    if (e && e.code === 'ENOENT') { io.err.write(`agent-cite-check: ${e.message}\n`); return 2; }
    if (e && /git/.test(String(e.message)) && e.status) { io.err.write(`agent-cite-check: git failed: ${String(e.stderr || e.message).trim()}\n`); return 2; }
    io.err.write(`agent-cite-check: ${e && e.stack ? e.stack : e}\n`);
    return 2;
  }
}
