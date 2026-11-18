// Change check: what really changed in the workspace vs. what the report says it changed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { globToRegExp, toPosix } from './text.js';
import { MAX_BYTES, isUnc, ScanError } from './workspace.js';

const NOCASE = process.platform === 'win32' || process.platform === 'darwin';

export { ScanError } from './workspace.js';

/**
 * Snapshot every file under the workspace root: { rel: { size, sha256 } }, and { rel: { link } }
 * for symbolic links and junctions (the target is recorded, never followed). Throws ScanError when
 * part of the tree cannot be read, rather than pass off a partial snapshot as complete.
 */
export function takeSnapshot(ws) {
  const files = {};
  const idx = ws.index();
  const problems = [...ws.scanProblems];
  // Bound descriptor usage and amortize the Windows handle query across each batch.
  for (let i = 0; i < idx.length; i += 32) {
    const opened = [];
    try {
      for (const rel of idx.slice(i, i + 32)) {
        try { opened.push({ rel, ...ws.openFile(path.join(ws.root, rel)) }); }
        catch (e) { if (e.code !== 'ENOENT') problems.push({ path: rel, reason: e.code ?? 'error' }); }
      }
      if (!opened.length) continue;
      ws.verifyOpen(opened);
      for (const { rel, fd, size } of opened) {
        try {
          const sha256 = size > MAX_BYTES * 8 ? null : crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex');
          files[rel] = { size, sha256 };
        } catch (e) { problems.push({ path: rel, reason: e.code ?? 'error' }); }
      }
    } catch (e) {
      problems.push({ path: opened[0].rel, reason: e.code ?? 'cannot verify open files' });
    } finally {
      for (const { fd } of opened) fs.closeSync(fd);
    }
  }
  for (const rel of ws.links()) {
    try {
      const abs = path.join(ws.root, rel);
      const parent = path.dirname(abs);
      if (parent !== ws.root && ws.locate(parent) !== 'inside') throw Object.assign(new Error('parent changed'), { code: 'ESTALE' });
      files[rel] = { link: fs.readlinkSync(abs) };
    } catch (e) {
      if (e.code !== 'ENOENT') problems.push({ path: rel, reason: e.code ?? 'error' });
    }
  }
  if (problems.length) throw new ScanError(problems);
  // `links: true` marks a snapshot that records links (0.1.1 and later); older ones did not
  return { tool: 'agent-cite-check', kind: 'snapshot', created: new Date().toISOString(), links: true, files };
}

/** Is this parsed JSON a snapshot written by takeSnapshot (any version)? */
export function isSnapshot(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  if (s.tool !== 'agent-cite-check' || s.kind !== 'snapshot') return false;
  if (!s.files || typeof s.files !== 'object' || Array.isArray(s.files)) return false;
  return Object.values(s.files).every((f) => f && typeof f === 'object' &&
    (typeof f.link === 'string' || (Number.isSafeInteger(f.size) && f.size >= 0 && (f.sha256 === null ? f.size > MAX_BYTES * 8 : typeof f.sha256 === 'string' && /^[a-f0-9]{64}$/.test(f.sha256)))));
}

function differs(old, cur) {
  if ((old.link ?? null) !== (cur.link ?? null)) return true;
  if (cur.link != null) return false;
  return old.size !== cur.size || (old.sha256 && cur.sha256 && old.sha256 !== cur.sha256);
}

/** Changes between a saved snapshot and the workspace now. */
export function diffSnapshot(before, ws) {
  const now = takeSnapshot(ws).files;
  const prev = before.files ?? {};
  if (before.links !== true && ws.links().length) {
    throw new ScanError([{ path: '.', reason: 'old snapshot has no link baseline; take a new snapshot' }]);
  }
  const out = [];
  for (const [rel, cur] of Object.entries(now)) {
    const old = prev[rel];
    if (!old) out.push({ path: rel, change: 'added' });
    else if (differs(old, cur)) out.push({ path: rel, change: 'modified' });
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
  const add = (p, change) => {
    if (!p.startsWith(prefix)) return;
    const rel = p.slice(prefix.length);
    if (!rel || ws.ignored(rel)) return;
    out.push({ path: rel, change });
  };
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    const xy = e.slice(0, 2);
    const p = e.slice(3);
    if (/[RC]/.test(xy)) {
      // "R  new\0old": a rename deletes the old path and adds the new one; a copy only adds
      const orig = parts[++i];
      if (xy[1] !== 'D') add(p, 'added');
      if (xy.includes('R') && orig) add(orig, 'deleted');
      continue;
    }
    add(p, xy === '??' || xy.includes('A') ? 'added' : xy.includes('D') ? 'deleted' : 'modified');
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
    if (isUnc(p)) {
      rep.set(key(p), { ...r, rel: p, inRoot: false });
      continue;
    }
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
    const inRoot = rel ?? ws.rel(tries[0]);
    rep.set(key(inRoot ?? p), { ...r, rel: inRoot ?? p, inRoot: inRoot !== null });
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
    // only paths inside the root are looked up; a listed path outside it is not opened at all
    const location = r.inRoot ? ws.locate(path.join(ws.root, r.rel)) : 'outside';
    const exists = location === 'inside';
    items.push({ path: r.rel, change: null, reported: r.change ?? true, status: 'phantom', exists, ...(location === 'outside' ? { outside: true } : {}), at: r.at });
  }
  return items;
}

export const CHANGE_PASS = new Set(['ok', 'kind_differs']);
