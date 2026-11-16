// Text helpers: decoding, line splitting, normalization, similarity, globs.

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const UTF8_LOSSY = new TextDecoder('utf-8');
let GB = null;
try { GB = new TextDecoder('gb18030', { fatal: true }); } catch { GB = null; }

/** Decode a file buffer. Returns { text, encoding }; text is null for binary files. */
export function decode(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf-16le' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const b = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1)));
    b.swap16();
    return { text: b.toString('utf16le'), encoding: 'utf-16be' };
  }
  const start = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  const body = buf.subarray(start);
  if (body.subarray(0, 8192).includes(0)) return { text: null, encoding: 'binary' };
  try { return { text: UTF8.decode(body), encoding: 'utf-8' }; } catch { /* not UTF-8 */ }
  if (GB) {
    try { return { text: GB.decode(body), encoding: 'gb18030' }; } catch { /* not GB18030 either */ }
  }
  return { text: UTF8_LOSSY.decode(body), encoding: 'utf-8-lossy' };
}

/** Split into lines (1 line per \n, \r\n or \r). A trailing newline does not add an empty line. */
export function splitLines(text) {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Full-width ASCII (U+FF01–FF5E) to half-width, ideographic space to space, curly quotes to straight. */
export function fold(s) {
  return s
    .normalize('NFC')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/[“”„‟〝〞]/g, '"')
    .replace(/[‘’‚‛]/g, "'");
}

/** Matching form: fold() plus all whitespace (spaces, tabs, line breaks) removed. */
export function normalize(s) {
  return fold(s).replace(/\s+/gu, '');
}

/** Bigram Dice similarity of two normalized strings (0..1). */
export function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let inter = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const c = grams.get(g);
    if (c > 0) { inter++; grams.set(g, c - 1); }
  }
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

/** Best Dice similarity of `q` against any window of `hay` with q's length. Returns { score, index }. */
export function bestWindow(q, hay) {
  if (!q.length || !hay.length) return { score: 0, index: -1 };
  if (hay.length <= q.length) return { score: dice(q, hay), index: 0 };
  const step = Math.max(1, Math.floor(q.length / 6));
  let best = { score: -1, index: 0 };
  for (let i = 0; i <= hay.length - q.length; i += step) {
    const s = dice(q, hay.slice(i, i + q.length));
    if (s > best.score) best = { score: s, index: i };
  }
  // refine around the best coarse hit
  const lo = Math.max(0, best.index - step), hi = Math.min(hay.length - q.length, best.index + step);
  for (let i = lo; i <= hi; i++) {
    const s = dice(q, hay.slice(i, i + q.length));
    if (s > best.score) best = { score: s, index: i };
  }
  return best;
}

/** Glob (posix-style, `*`, `**`, `?`) to an anchored RegExp. */
export function globToRegExp(glob, { nocase = false } = {}) {
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, nocase ? 'i' : '');
}

export const isGlob = (s) => /[*?]/.test(s);

/** Posix-style path for comparisons and output. */
export const toPosix = (p) => p.replace(/\\/g, '/');
