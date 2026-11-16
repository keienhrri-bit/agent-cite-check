// Change check: what really changed in the workspace vs. what the report says it changed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { globToRegExp, toPosix } from './text.js';
import { MAX_BYTES } from './workspace.js';

const NOCASE = process.platform === 'win32' || process.platform === 'darwin';

function hashFile(abs) {
  const st = fs.statSync(abs);
  if (st.size > MAX_BYTES * 8) return { size: st.size, sha256: null };
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(abs));
  return { size: st.size, sha256: h.digest('hex') };
}

/** Snapshot every file under the workspace root: { rel: { size, sha256 } }. */
export function takeSnapshot(ws) {
  const files = {};
  for (const rel of ws.index()) {
    try { files[rel] = hashFile(path.join(ws.root, rel)); } catch { /* vanished while walking */ }
  }
  return { tool: 'agent-cite-check', kind: 'snapshot', created: new Date().toISOString(), files };
}

/** Changes between a saved snapshot and the workspace now. */
export function diffSnapshot(before, ws) {
  const now = takeSnapshot(ws).files;
  const prev = before.files ?? {};
  const out = [];
  for (const [rel, cur] of Object.entries(now)) {
    const old = prev[rel];
    if (!old) out.push({ path: rel, change: 'added' });
    else if (old.size !== cur.size || (old.sha256 && cur.sha256 && old.sha256 !== cur.sha256)) out.push({ path: rel, change: 'modified' });
  }
  for (const rel of Object.keys(prev)) {
    if (!(rel in now) && !ws.ignored(rel)) out.push({ path: rel, change: 'deleted' });
  }
  return out;
}

/** Changes reported by `git status` (relative to HEAD, untracked files included). */
export function gitChanges(ws) {
  const run = (args) => execFileSync('git', ['-C', ws.root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // Porcelain paths are relative to the repository top. Strip the root's own prefix instead of
  // comparing absolute paths: on Windows the root may be spelled differently from git's
  // top-level path (8.3 short names such as C:\Users\RUNNER~1, drive-letter case, junctions).
  const prefix = run(['rev-parse', '--show-prefix']).trim();
  const raw = run(['-c', 'core.quotepath=off', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  const parts = raw.split('\0').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    const xy = e.slice(0, 2);
    const p = e.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // next entry is the original path
    if (!p.startsWith(prefix)) continue;
    const rel = p.slice(prefix.length);
    if (!rel || ws.ignored(rel)) continue;
    const change = xy === '??' || xy.includes('A') ? 'added' : xy.includes('D') ? 'deleted' : 'modified';
    out.push({ path: rel, change });
  }
  return out;
}

/**
 * Reconcile actual changes with the files the report lists.
 * opts: { exclude: Set<rel>, writable: glob[], protect: glob[] }
 */
export function reconcile(actual, reported, ws, opts = {}) {
  const key = (p) => (NOCASE ? p.toLowerCase() : p);
  const exclude = new Set([...(opts.exclude ?? [])].map(key));
  const writable = (opts.writable ?? []).map((g) => globToRegExp(g, { nocase: NOCASE }));
  const protect = (opts.protect ?? []).map((g) => globToRegExp(g, { nocase: NOCASE }));
  const allowed = (rel) => (!writable.length || writable.some((re) => re.test(rel))) && !protect.some((re) => re.test(rel));

  // Reported paths may be relative to the root, to the report's folder, absolute, or a shorter suffix.
  const actualKeys = new Map(actual.map((a) => [key(a.path), a.path]));
  const rep = new Map();
  for (const r of reported) {
    const p = toPosix(String(r.path).trim()).replace(/^\.\//, '');
    const isAbs = path.isAbsolute(p) || /^[A-Za-z]:\//.test(p);
    const tries = isAbs ? [path.resolve(p)] : [path.resolve(ws.root, p), ...(opts.reportDir ? [path.resolve(opts.reportDir, p)] : [])];
    let rel = null;
    for (const t of tries) {
      const r2 = ws.rel(t);
      if (r2 !== null && (actualKeys.has(key(r2)) || exclude.has(key(r2)))) { rel = r2; break; }
    }
    if (rel === null) {
      const suffix = [...actualKeys.values()].filter((a) => key(a).endsWith('/' + key(p).replace(/^.*?:\//, '')) || key(p).endsWith('/' + key(a)));
      if (suffix.length === 1) rel = suffix[0];
    }
    if (rel === null) rel = ws.rel(tries[0]) ?? p;
    rep.set(key(rel), { ...r, rel });
  }

  const items = [];
  const seen = new Set();
  for (const a of actual) {
    const k = key(a.path);
    if (exclude.has(k)) {
      // the report file itself (or the snapshot): fine whether or not the report lists it
      if (rep.has(k)) { seen.add(k); items.push({ path: a.path, change: a.change, reported: rep.get(k).change ?? true, status: 'ok', at: rep.get(k).at }); }
      continue;
    }
    seen.add(k);
    const r = rep.get(k);
    if (!allowed(a.path)) {
      items.push({ path: a.path, change: a.change, reported: !!r, status: 'forbidden' });
    } else if (!r) {
      items.push({ path: a.path, change: a.change, reported: false, status: 'unreported' });
    } else if (r.change && r.change !== a.change) {
      items.push({ path: a.path, change: a.change, reported: r.change, status: 'kind_differs', at: r.at });
    } else {
      items.push({ path: a.path, change: a.change, reported: r.change ?? true, status: 'ok', at: r.at });
    }
  }
  for (const [k, r] of rep) {
    if (seen.has(k) || exclude.has(k)) continue;
    const exists = fs.existsSync(path.resolve(ws.root, r.rel));
    items.push({ path: r.rel, change: null, reported: r.change ?? true, status: 'phantom', exists, at: r.at });
  }
  return items;
}

export const CHANGE_PASS = new Set(['ok', 'kind_differs']);
