// Workspace: resolves the paths an agent wrote to real files, and caches file contents.
import fs from 'node:fs';
import path from 'node:path';
import { decode, splitLines, normalize, globToRegExp, toPosix } from './text.js';

const DEFAULT_IGNORE = ['.git/**', 'node_modules/**'];
const MAX_FILES = 200000;
export const MAX_BYTES = 64 * 1024 * 1024;
const NOCASE = process.platform === 'win32' || process.platform === 'darwin';

export class Workspace {
  constructor(root, { ignore = [] } = {}) {
    this.root = path.resolve(root);
    this.ignore = [...DEFAULT_IGNORE, ...ignore].map((g) => globToRegExp(g, { nocase: NOCASE }));
    this.cache = new Map();
    this._index = null;
  }

  /** Path relative to root, posix separators; null if outside root. */
  rel(abs) {
    const r = path.relative(this.root, abs);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
    return toPosix(r);
  }

  ignored(rel) {
    return this.ignore.some((re) => re.test(rel));
  }

  /** All files under root (posix relative paths), ignoring .git, node_modules and --ignore globs. */
  index() {
    if (this._index) return this._index;
    const out = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (out.length >= MAX_FILES) return;
        const abs = path.join(dir, e.name);
        const rel = toPosix(path.relative(this.root, abs));
        if (e.isDirectory()) {
          if (this.ignored(rel + '/') || this.ignored(rel + '/x')) continue;
          walk(abs);
        } else if (e.isFile()) {
          if (!this.ignored(rel)) out.push(rel);
        }
      }
    };
    walk(this.root);
    out.sort();
    this._index = out;
    return out;
  }

  /**
   * Resolve a path as written by an agent. Tries, in order: absolute path, path relative to root,
   * then the file index (agent wrote a longer or shorter path, or glued words in front of the name).
   * Returns { abs: string[], how }.
   */
  resolve(written) {
    let p = written.trim().replace(/^`+|`+$/g, '').replace(/^["']|["']$/g, '');
    p = toPosix(p).replace(/^\.\//, '');
    if (!p) return { abs: [], how: 'none' };
    const isAbs = path.isAbsolute(p) || /^[A-Za-z]:\//.test(p);
    const direct = isAbs ? p : path.join(this.root, p);
    if (isFile(direct)) return { abs: [path.resolve(direct)], how: 'exact' };

    const idx = this.index();
    const cand = NOCASE ? p.toLowerCase() : p;
    const key = (r) => (NOCASE ? r.toLowerCase() : r);
    // 1. agent wrote a longer path (absolute path from another machine, extra folders) or a shorter one
    let hits = idx.filter((r) => {
      const k = key(r);
      return k === cand || cand.endsWith('/' + k) || k.endsWith('/' + cand);
    });
    if (hits.length) {
      // prefer the longest overlap
      const score = (r) => Math.min(key(r).length, cand.length);
      const best = Math.max(...hits.map(score));
      hits = hits.filter((r) => score(r) === best);
      return { abs: hits.map((r) => path.join(this.root, r)), how: hits.length > 1 ? 'ambiguous' : 'suffix' };
    }
    // 2. words glued in front of the file name, e.g. "见notes.md" or "seenotes.md"? only non-ASCII glue
    hits = idx.filter((r) => {
      const k = key(r);
      if (!cand.endsWith(k) || cand.length === k.length) return false;
      const before = cand[cand.length - k.length - 1];
      return /[^\x00-\x7F]/.test(before);
    });
    if (hits.length) {
      const best = Math.max(...hits.map((r) => r.length));
      hits = hits.filter((r) => r.length === best);
      return { abs: hits.map((r) => path.join(this.root, r)), how: hits.length > 1 ? 'ambiguous' : 'glued' };
    }
    return { abs: [], how: 'none' };
  }

  /** Display form of an absolute path: relative to root when inside it. */
  show(abs) {
    return this.rel(abs) ?? toPosix(abs);
  }

  /** Load a text file: { text, lines, norm, offs, encoding } or { error }. */
  load(abs) {
    if (this.cache.has(abs)) return this.cache.get(abs);
    let res;
    try {
      const st = fs.statSync(abs);
      if (st.size > MAX_BYTES) res = { error: 'too_large' };
      else {
        const { text, encoding } = decode(fs.readFileSync(abs));
        if (text === null) res = { error: 'binary' };
        else {
          const lines = splitLines(text);
          const norm = lines.map(normalize);
          const offs = new Array(norm.length);
          let o = 0;
          for (let i = 0; i < norm.length; i++) { offs[i] = o; o += norm[i].length; }
          res = { text, lines, norm, offs, joined: norm.join(''), encoding };
        }
      }
    } catch (e) {
      res = { error: e.code === 'ENOENT' ? 'missing' : 'unreadable' };
    }
    this.cache.set(abs, res);
    return res;
  }

  /** Files under root matching a glob. */
  glob(pattern) {
    const re = globToRegExp(toPosix(pattern).replace(/^\.\//, ''), { nocase: NOCASE });
    return this.index().filter((r) => re.test(r)).map((r) => path.join(this.root, r));
  }
}

export function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/** 1-based line number containing normalized offset `pos`. */
export function lineAt(doc, pos) {
  let lo = 0, hi = doc.offs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (doc.offs[mid] <= pos) lo = mid; else hi = mid - 1;
  }
  // skip empty lines that share the same offset
  while (lo + 1 < doc.offs.length && doc.offs[lo + 1] === pos && doc.norm[lo].length === 0) lo++;
  return lo + 1;
}
