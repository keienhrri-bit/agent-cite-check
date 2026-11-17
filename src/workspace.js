// Workspace: resolves the paths an agent wrote to real files, and caches file contents.
// Only files inside the root are ever read. A report is untrusted input: absolute paths, `..`,
// UNC paths and links that lead out of the root are refused before the file is opened.
import fs from 'node:fs';
import path from 'node:path';
import { decode, splitLines, normalize, globToRegExp, toPosix } from './text.js';

const DEFAULT_IGNORE = ['.git/**', 'node_modules/**'];
export const MAX_FILES = 200000;
export const MAX_BYTES = 64 * 1024 * 1024;
const NOCASE = process.platform === 'win32' || process.platform === 'darwin';

/** UNC and device paths (\\server\share, //server/share, \\?\C:\..., \\.\pipe\...). Never touched. */
export const isUnc = (p) => /^[\\/]{2}/.test(String(p).trim());

const inside = (rel) => !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);

export class Workspace {
  constructor(root, { ignore = [], maxFiles = MAX_FILES } = {}) {
    this.root = path.resolve(root);
    this.ignore = [...DEFAULT_IGNORE, ...ignore].map((g) => globToRegExp(g, { nocase: NOCASE }));
    this.maxFiles = maxFiles;
    this.cache = new Map();
    this.where = new Map();
    this._index = null;
    this._links = null;
    this._realRoot = undefined;
    /** Parts of the tree the last index() could not cover: [{ path, reason }]. */
    this.scanProblems = [];
  }

  /** Path relative to root, posix separators; null if outside root. Purely lexical: no file access. */
  rel(abs) {
    if (isUnc(abs) && !isUnc(this.root)) return null;
    const r = path.relative(this.root, abs);
    return inside(r) ? toPosix(r) : null;
  }

  /**
   * Where a path really is once links and junctions are followed: 'inside', 'outside' or 'missing'.
   * Paths that are outside the root as written (UNC paths included) are answered without file access.
   */
  locate(abs) {
    if (this.rel(abs) === null) return 'outside';
    if (this.where.has(abs)) return this.where.get(abs);
    if (this._realRoot === undefined) {
      try { this._realRoot = fs.realpathSync.native(this.root); } catch { this._realRoot = null; }
    }
    let res;
    try {
      // the same function on both sides, so 8.3 short names and drive-letter case cannot differ
      const real = fs.realpathSync.native(abs);
      const k = (s) => (NOCASE ? s.toLowerCase() : s);
      res = this._realRoot && inside(path.relative(k(this._realRoot), k(real))) ? 'inside' : 'outside';
    } catch {
      res = 'missing';
    }
    this.where.set(abs, res);
    return res;
  }

  ignored(rel) {
    return this.ignore.some((re) => re.test(rel));
  }

  /**
   * All regular files under root (posix relative paths), ignoring .git, node_modules and --ignore
   * globs. Folders that cannot be read, and a tree larger than maxFiles, are listed in scanProblems.
   */
  index() {
    if (this._index) return this._index;
    const files = [];
    const links = [];
    const problems = [];
    let full = false;
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        if (e.code !== 'ENOENT') problems.push({ path: toPosix(path.relative(this.root, dir)) || '.', reason: e.code ?? 'error' });
        return;
      }
      for (const e of entries) {
        if (files.length + links.length >= this.maxFiles) { full = true; return; }
        const abs = path.join(dir, e.name);
        const rel = toPosix(path.relative(this.root, abs));
        if (e.isDirectory()) {
          // prune a folder only when a glob covers the folder itself ("dist/**"), not one file in it
          if (!this.ignored(rel + '/')) walk(abs);
        } else if (this.ignored(rel)) continue;
        else if (e.isFile()) files.push(rel);
        else if (e.isSymbolicLink()) links.push(rel); // never followed or read; snapshots record the target
      }
    };
    walk(this.root);
    if (full) problems.push({ path: '.', reason: `more than ${this.maxFiles} files` });
    files.sort();
    links.sort();
    this._index = files;
    this._links = links;
    this.scanProblems = problems;
    return files;
  }

  /** Symbolic links and junctions under root (posix relative paths). */
  links() {
    this.index();
    return this._links;
  }

  /**
   * Resolve a path as written by an agent. Tries, in order: the path itself when it lies inside the
   * root, then the file index (the agent wrote a longer or shorter path, an absolute path from
   * another machine, or glued words in front of the name). Paths outside the root are never opened.
   * Returns { abs: string[], how }; how is 'outside' when the path points out of the root.
   */
  resolve(written) {
    let p = String(written).trim().replace(/^`+|`+$/g, '').replace(/^["']|["']$/g, '');
    const unc = isUnc(p);
    p = toPosix(p).replace(/^\.\//, '');
    if (!p) return { abs: [], how: 'none' };
    let outside = unc;
    if (!unc) {
      const isAbs = path.isAbsolute(p) || /^[A-Za-z]:\//.test(p);
      const direct = isAbs ? path.resolve(p) : path.resolve(this.root, p);
      if (this.rel(direct) === null) outside = true;
      else if (isFile(direct)) {
        // a link inside the root that leads out of it is refused, not looked up elsewhere
        return this.locate(direct) === 'inside' ? { abs: [direct], how: 'exact' } : { abs: [], how: 'outside' };
      }
    }

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
      const best = maxOf(hits.map(score));
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
      const best = maxOf(hits.map((r) => r.length));
      hits = hits.filter((r) => r.length === best);
      return { abs: hits.map((r) => path.join(this.root, r)), how: hits.length > 1 ? 'ambiguous' : 'glued' };
    }
    return { abs: [], how: outside ? 'outside' : 'none' };
  }

  /** Display form of an absolute path: relative to root when inside it. */
  show(abs) {
    return this.rel(abs) ?? toPosix(abs);
  }

  /** Load a text file inside the root: { text, lines, norm, offs, encoding } or { error }. */
  load(abs) {
    if (this.cache.has(abs)) return this.cache.get(abs);
    let res;
    const where = this.locate(abs);
    if (where !== 'inside') {
      res = { error: where === 'missing' ? 'missing' : 'outside_root' };
      this.cache.set(abs, res);
      return res;
    }
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

/** Largest value of a list without spreading it into call arguments (long lists overflow). */
export function maxOf(xs) {
  let m = -Infinity;
  for (const x of xs) if (x > m) m = x;
  return m;
}

/** Smallest value of a list without spreading it into call arguments. */
export function minOf(xs) {
  let m = Infinity;
  for (const x of xs) if (x < m) m = x;
  return m;
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
