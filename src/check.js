// Run all checks on a parsed report and build the result object.
import fs from 'node:fs';
import path from 'node:path';
import { parseReport } from './parse.js';
import { verifyCitation, CITE_PASS } from './cites.js';
import { verifyNumber } from './numbers.js';
import { diffSnapshot, gitChanges, reconcile, CHANGE_PASS } from './changes.js';

export const VERSION = '0.1.0';

export const DEFAULTS = {
  tolerance: 3,
  minQuote: 5,
  nearThreshold: 0.5,
  maxFailures: 0,
  allowNoQuote: false,
  allowEmpty: false,
  sample: null,
  seed: 1,
};

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick which citation indexes to check: all, a count ("10") or a share ("20%"). */
function pickSample(n, sample, seed) {
  const all = [...Array(n).keys()];
  if (!sample) return all;
  const m = /^(\d+(?:\.\d+)?)(%?)$/.exec(String(sample).trim());
  if (!m) throw new Error(`bad --sample value: ${sample}`);
  const k = Math.min(n, m[2] ? Math.ceil((n * Number(m[1])) / 100) : Number(m[1]));
  const rnd = mulberry32(Number(seed) || 1);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, k).sort((x, y) => x - y);
}

/**
 * opts: tolerance, minQuote, nearThreshold, allowNoQuote, maxFailures, allowEmpty, sample, seed,
 *       before (snapshot object), git (bool), writable[], protect[], exclude[] (abs paths)
 */
export function runChecks(reportText, ws, opts = {}, reportName = 'report') {
  const o = { ...DEFAULTS, ...opts };
  const parsed = parseReport(reportText, reportName);

  // citations
  const picked = new Set(pickSample(parsed.citations.length, o.sample, o.seed));
  const citeItems = [];
  parsed.citations.forEach((c, i) => {
    if (!picked.has(i)) return;
    const r = verifyCitation(c, ws, o);
    let pass = CITE_PASS.has(r.status);
    if (r.status === 'no_quote' && o.allowNoQuote) pass = true;
    citeItems.push({
      id: c.label ?? String(i + 1),
      at: c.at,
      raw: c.raw,
      file: r.file ?? c.file,
      line: c.line,
      endLine: c.endLine,
      quote: c.quote,
      status: r.status,
      pass,
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.resolved ? { resolved: r.resolved } : {}),
      ...(r.candidates ? { candidates: r.candidates } : {}),
    });
  });

  // numbers
  const numItems = parsed.numbers.map((n, i) => {
    const r = verifyNumber(n, ws, o);
    return { id: `n${i + 1}`, at: n.at, expr: n.expr, claimed: n.claimed, ...r, pass: r.status === 'ok' };
  });

  // file changes
  let changes = null;
  if (o.before || o.git) {
    const actual = o.git ? gitChanges(ws) : diffSnapshot(o.before, ws);
    const exclude = (o.exclude ?? []).map((p) => ws.rel(path.resolve(p))).filter(Boolean);
    const items = reconcile(actual, parsed.files, ws, { exclude, writable: o.writable, protect: o.protect, reportDir: o.reportDir });
    changes = {
      mode: o.git ? 'git' : 'snapshot',
      items,
      passed: items.filter((i) => CHANGE_PASS.has(i.status)).length,
      failed: items.filter((i) => !CHANGE_PASS.has(i.status)).length,
    };
  }

  const citations = {
    total: parsed.citations.length,
    checked: citeItems.length,
    passed: citeItems.filter((i) => i.pass).length,
    failed: citeItems.filter((i) => !i.pass).length,
    items: citeItems,
  };
  const numbers = {
    total: numItems.length,
    passed: numItems.filter((i) => i.pass).length,
    failed: numItems.filter((i) => !i.pass).length,
    items: numItems,
  };
  const failures = citations.failed + numbers.failed + (changes ? changes.failed : 0);
  const empty = !citations.total && !numbers.total && !changes;
  const verdict = (empty && !o.allowEmpty) || failures > o.maxFailures ? 'fail' : 'pass';
  return {
    tool: 'agent-cite-check',
    version: VERSION,
    verdict,
    failures,
    empty,
    report: reportName,
    root: ws.root,
    format: parsed.format,
    options: { tolerance: o.tolerance, minQuote: o.minQuote, sample: o.sample, seed: o.sample ? o.seed : undefined },
    citations,
    numbers,
    changes,
  };
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}
