// Workspace: resolves the paths an agent wrote to real files, and caches file contents.
// Only files inside the root are ever read. A report is untrusted input: absolute paths, `..`,
// UNC paths and links that lead out of the root are refused before the file is opened.
import fs from 'node:fs';
import path from 'node:path';
import { descriptorPaths } from './descriptor.js';
import { decode, splitLines, normalize, globToRegExp, toPosix } from './text.js';

const DEFAULT_IGNORE = ['.git/**', 'node_modules/**'];
export const MAX_FILES = 200000;
export const MAX_BYTES = 64 * 1024 * 1024;
const NOCASE = process.platform === 'win32' || process.platform === 'darwin';

/** UNC and device paths (\\server\share, //server/share, \\?\C:\..., \\.\pipe\...). Never touched. */
export const isUnc = (p) => /^[\\/]{2}/.test(String(p).trim());

const inside = (rel) => !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);

/** The folder could not be scanned completely, so a change check would miss part of it. */
export class ScanError extends Error {
  constructor(problems) {
    const list = problems.slice(0, 5).map((p) => `${p.path} (${p.reason})`).join(', ');
    super(`cannot scan the whole folder: ${list}${problems.length > 5 ? ` and ${problems.length - 5} more` : ''}; skip these with --ignore GLOB or pick a smaller --root`);
    this.problems = problems;
  }
}

export class Workspace {
  constructor(root, { ignore = [], maxFiles = MAX_FILES } = {}) {
    this.root = path.resolve(root);
    this.ignore = [...DEFAULT_IGNORE, ...ignore].map((g) => globToRegExp(g, { nocase: NOCASE }));
    this.maxFiles = maxFiles;
    this.cache = new Map();
    this._index = null;
    this._links = null;
    this._realRoot = fs.realpathSync.native(this.root);
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
    try {
      if (!this.localComponents(abs)) return 'outside';
      const real = fs.realpathSync.native(abs);
      return this.containsReal(real) ? 'inside' : 'outside';
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      return 'missing';
    }
  }

  localComponents(abs) {
    let parts = this.rel(abs).split('/');
    let dir = this.root;
    let hops = 0;
    for (let i = 0; i < parts.length; i++) {
      const child = path.join(dir, parts[i]);
      if (!fs.lstatSync(child).isSymbolicLink()) {
        dir = child;
        continue;
      }
      const target = fs.readlinkSync(child);
      if (isUnc(target) || ++hops > 40) return false;
      const resolved = path.resolve(dir, target);
      const rel = this.rel(resolved);
      if (rel === null && resolved !== this.root) return false;
      parts = [...(rel ? rel.split('/') : []), ...parts.slice(i + 1)];
      dir = this.root;
      i = -1;
    }
    return true;
  }

  containsReal(real) {
    const prefix = this._realRoot.endsWith(path.sep) ? this._realRoot : this._realRoot + path.sep;
    return real.startsWith(prefix) && real.length > prefix.length;
  }

  /** Read only through the descriptor whose object and location were checked. */
  openFile(abs) {
    const location = this.locate(abs);
    if (location !== 'inside') throw Object.assign(new Error(location), { code: location === 'missing' ? 'ENOENT' : 'OUTSIDE' });
    const real = fs.realpathSync.native(abs);
    if (!this.containsReal(real)) throw Object.assign(new Error('outside root'), { code: 'OUTSIDE' });
    const expected = fs.lstatSync(real, { bigint: true });
    if (!expected.isFile()) throw new Error('not a regular file');
    const fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    try {
      const st = fs.fstatSync(fd, { bigint: true });
      if (!st.isFile() || st.dev !== expected.dev || st.ino !== expected.ino) {
        throw Object.assign(new Error('file moved outside root or replaced'), { code: 'OUTSIDE' });
      }
      return { fd, size: Number(st.size) };
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
  }

  verifyOpen(files) {
    const paths = descriptorPaths(files.map(f => f.fd));
    if (paths.length !== files.length || paths.some(p => !this.containsReal(p))) {
      throw Object.assign(new Error('opened file outside root'), { code: 'OUTSIDE' });
    }
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
        if (dir !== this.root && this.locate(dir) !== 'inside') throw Object.assign(new Error('directory changed'), { code: 'ESTALE' });
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        if (e.code !== 'ENOENT') problems.push({ path: toPosix(path.relative(this.root, dir)) || '.', reason: e.code ?? 'error' });
        return;
      }
      for (const e of entries) {
        if (full) return;
        const abs = path.join(dir, e.name);
        const rel = toPosix(path.relative(this.root, abs));
        if (e.isDirectory()) {
          // prune a folder only when a glob covers the folder itself ("dist/**"), not one file in it
          if (!this.ignored(rel + '/')) walk(abs);
        } else if (this.ignored(rel) || (!e.isFile() && !e.isSymbolicLink())) continue;
        else if (files.length + links.length >= this.maxFiles) { full = true; return; }
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

  completeIndex() {
    const files = this.index();
    if (this.scanProblems.length) throw new ScanError(this.scanProblems);
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
    if (isUnc(p)) return { abs: [], how: 'outside' };
    p = toPosix(p).replace(/^\.\//, '');
    if (!p) return { abs: [], how: 'none' };
    const isAbs = path.isAbsolute(p) || /^[A-Za-z]:\//.test(p);
    const direct = isAbs ? path.resolve(p) : path.resolve(this.root, p);
    const outside = this.rel(direct) === null;
    if (!outside) {
      const location = this.locate(direct);
      if (location === 'outside') return { abs: [], how: 'outside' };
      if (location === 'inside' && isFile(direct)) return { abs: [direct], how: 'exact' };
    }

    const idx = this.completeIndex();
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
    let res;
    try {
      if (this.cache.has(abs) && this.locate(abs) === 'inside') return this.cache.get(abs);
      const file = this.openFile(abs);
      try {
        this.verifyOpen([file]);
        const { fd, size } = file;
        if (size > MAX_BYTES) return { error: 'too_large' };
        const { text, encoding } = decode(fs.readFileSync(fd));
        if (text === null) res = { error: 'binary' };
        else {
          const lines = splitLines(text);
          const norm = lines.map(normalize);
          const offs = new Array(norm.length);
          let o = 0;
          for (let i = 0; i < norm.length; i++) { offs[i] = o; o += norm[i].length; }
          res = { text, lines, norm, offs, joined: norm.join(''), encoding };
        }
      } finally {
        fs.closeSync(file.fd);
      }
    } catch (e) {
      res = { error: e.code === 'OUTSIDE' ? 'outside_root' : e.code === 'ENOENT' ? 'missing' : 'unreadable' };
    }
    if (!res.error) this.cache.set(abs, res);
    return res;
  }

  /** Files under root matching a glob. */
  glob(pattern) {
    const re = globToRegExp(toPosix(pattern).replace(/^\.\//, ''), { nocase: NOCASE });
    return this.completeIndex().filter((r) => re.test(r)).map((r) => path.join(this.root, r));
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
