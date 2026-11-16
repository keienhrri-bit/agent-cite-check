// Recompute declared numbers: lines(), count(), lines_with(), files(), rows(), sum(), avg(), min(), max(), distinct().
import path from 'node:path';
import { fold, isGlob } from './text.js';

/** Split an argument list on commas outside "quotes" and /regex/. */
export function splitArgs(s) {
  const out = [];
  let cur = '', q = null, re = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (c === q) q = null;
    } else if (re) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (c === '/') re = false;
    } else if (c === '"' || c === '“' || c === '「') {
      q = c === '"' ? '"' : c === '“' ? '”' : '」';
      cur += c;
    } else if (c === '/' && cur.trim() === '') {
      re = true;
      cur += c;
    } else if (c === ',' || c === '，') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function unquote(s) {
  const m = /^(?:"([\s\S]*)"|“([\s\S]*)”|「([\s\S]*)」)$/.exec(s.trim());
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3]).replace(/\\(["\\])/g, '$1');
}

function asRegex(s) {
  const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(s.trim());
  if (!m) return null;
  const flags = new Set(m[2].replace(/g/g, ''));
  flags.add('g');
  return new RegExp(m[1], [...flags].join(''));
}

const COND_RE = /^(?:where\s+)?(?<col>"[^"]+"|[^!=<>~]+?)\s*(?<op>!=|>=|<=|=|>|<|~)\s*(?<val>.+)$/i;
function parseCond(s) {
  const m = COND_RE.exec(s.trim());
  if (!m) return null;
  const col = unquote(m.groups.col) ?? m.groups.col.trim();
  const val = unquote(m.groups.val) ?? m.groups.val.trim();
  return { col, op: m.groups.op, val };
}
const isCond = (s) => unquote(s) === null && asRegex(s) === null && parseCond(s) !== null;

/** Parse a number as people write it: "1,234", "81.5", "12%", " 3 ". Returns NaN when not numeric. */
export function toNumber(v) {
  if (v == null) return NaN;
  let s = fold(String(v)).trim().replace(/%$/, '');
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  return Number(s);
}

/** Minimal RFC 4180 CSV parser; delimiter sniffed from the first line (comma, tab, semicolon). */
export function parseCsv(text, file = '') {
  text = text.replace(/^\uFEFF/, '');
  let delim = ',';
  if (/\.tsv$/i.test(file)) delim = '\t';
  else {
    const first = text.split(/\r?\n/, 1)[0] ?? '';
    const counts = [',', '\t', ';'].map((d) => [d, first.split(d).length]);
    counts.sort((x, y) => y[1] - x[1]);
    if (counts[0][1] > 1) delim = counts[0][0];
  }
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += c;
    } else if (c === '"' && cell === '') inQ = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return { header, rows };
}

function colIndex(header, col) {
  let i = header.indexOf(col);
  if (i < 0) i = header.findIndex((h) => h.toLowerCase() === col.toLowerCase());
  if (i < 0) i = header.findIndex((h) => fold(h) === fold(col));
  return i;
}

function rowFilter(header, conds) {
  const tests = conds.map((c) => {
    const i = colIndex(header, c.col);
    if (i < 0) throw new CheckError(`unknown column "${c.col}"`);
    return (row) => {
      const cell = fold(row[i] ?? '').trim();
      const val = fold(c.val).trim();
      const a = toNumber(cell), b = toNumber(val);
      const num = !Number.isNaN(a) && !Number.isNaN(b);
      switch (c.op) {
        case '=': return num ? a === b : cell === val;
        case '!=': return num ? a !== b : cell !== val;
        case '~': return cell.includes(val);
        case '>': return num && a > b;
        case '<': return num && a < b;
        case '>=': return num && a >= b;
        case '<=': return num && a <= b;
        default: return false;
      }
    };
  });
  return (row) => tests.every((t) => t(row));
}

export class CheckError extends Error {}

function countLiteral(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = hay.indexOf(needle);
  while (i >= 0) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

/** Resolve the first argument to a list of files (a glob may match many). */
function targetFiles(ws, arg) {
  const p = unquote(arg) ?? arg.replace(/^`|`$/g, '');
  if (isGlob(p)) {
    const files = ws.glob(p);
    return { files, glob: true };
  }
  const r = ws.resolve(p);
  if (!r.abs.length) throw new CheckError(`file not found: ${p}`);
  if (r.abs.length > 1) throw new CheckError(`ambiguous file name: ${p} (${r.abs.map((a) => ws.show(a)).join(', ')})`);
  return { files: r.abs, glob: false };
}

function loadText(ws, abs) {
  const doc = ws.load(abs);
  if (doc.error) throw new CheckError(`cannot read ${ws.show(abs)}: ${doc.error}`);
  return doc;
}

/** Compute the actual value of a declared expression. */
export function evaluate(n, ws) {
  const args = splitArgs(n.args);
  if (!args.length) throw new CheckError('missing file argument');
  const { files } = targetFiles(ws, args[0]);
  const rest = args.slice(1);
  const op = n.op;

  if (op === 'files') return files.length;
  if (op === 'lines') return files.reduce((s, f) => s + loadText(ws, f).lines.length, 0);

  const csvMode = ['rows', 'sum', 'avg', 'min', 'max', 'distinct'].includes(op) || ((op === 'count') && rest.length > 0 && rest.every(isCond));
  if (!csvMode) {
    if (op !== 'count' && op !== 'lines_with') throw new CheckError(`unknown operation ${op}`);
    if (rest.length !== 1) throw new CheckError(`${op}() needs a file and one "text" or /regex/`);
    const lit = unquote(rest[0]);
    const re = lit === null ? asRegex(rest[0]) : null;
    if (lit === null && !re) throw new CheckError(`second argument must be "text" or /regex/: ${rest[0]}`);
    let total = 0;
    for (const f of files) {
      const doc = loadText(ws, f);
      if (op === 'count') {
        if (re) total += [...doc.text.matchAll(re)].length;
        else total += countLiteral(fold(doc.text), fold(lit));
      } else {
        for (const ln of doc.lines) {
          if (re) { re.lastIndex = 0; if (re.test(ln)) total++; }
          else if (fold(ln).includes(fold(lit))) total++;
        }
      }
    }
    return total;
  }

  // CSV operations
  let column = null;
  let condArgs = rest;
  if (['sum', 'avg', 'min', 'max', 'distinct'].includes(op)) {
    if (!rest.length) throw new CheckError(`${op}() needs a column name`);
    column = unquote(rest[0]) ?? rest[0];
    condArgs = rest.slice(1);
  }
  const conds = condArgs.flatMap((a) => a.split(/\s+and\s+/i)).map((a) => {
    const c = parseCond(a);
    if (!c) throw new CheckError(`cannot read condition: ${a}`);
    return c;
  });
  const values = [];
  let rowCount = 0;
  for (const f of files) {
    const doc = loadText(ws, f);
    const { header, rows } = parseCsv(doc.text, f);
    const keep = rowFilter(header, conds);
    let ci = -1;
    if (column !== null) {
      ci = colIndex(header, column);
      if (ci < 0) throw new CheckError(`unknown column "${column}" in ${ws.show(f)} (columns: ${header.join(', ')})`);
    }
    for (const row of rows) {
      if (!keep(row)) continue;
      rowCount++;
      if (ci >= 0) values.push(row[ci] ?? '');
    }
  }
  if (op === 'rows' || op === 'count') return rowCount;
  if (op === 'distinct') return new Set(values.map((v) => fold(v).trim())).size;
  const nums = values.map(toNumber).filter((x) => !Number.isNaN(x));
  if (!nums.length) throw new CheckError(`no numeric values in column "${column}"`);
  if (op === 'sum') return nums.reduce((s, x) => s + x, 0);
  if (op === 'avg') return nums.reduce((s, x) => s + x, 0) / nums.length;
  if (op === 'min') return Math.min(...nums);
  if (op === 'max') return Math.max(...nums);
  throw new CheckError(`unknown operation ${op}`);
}

/** Compare at the precision the agent wrote: "81.5" is checked to one decimal; avg "81" to an integer. */
export function sameNumber(claimedStr, actual, op) {
  const claimed = toNumber(claimedStr);
  if (Number.isNaN(claimed)) return false;
  const dec = (String(claimedStr).split('.')[1] ?? '').replace(/%$/, '').length;
  if (dec > 0 || op === 'avg') {
    const f = 10 ** dec;
    return Math.abs(Math.round((actual + Number.EPSILON) * f) / f - claimed) < 1e-9;
  }
  return Math.abs(actual - claimed) <= 1e-9 * Math.max(1, Math.abs(claimed));
}

export function verifyNumber(n, ws) {
  if (!/\d/.test(n.claimed ?? '')) return { status: 'error', detail: { reason: 'no claimed value' } };
  try {
    const actual = evaluate(n, ws);
    const rounded = Math.round(actual * 1e6) / 1e6;
    return sameNumber(n.claimed, actual, n.op)
      ? { status: 'ok', actual: rounded }
      : { status: 'mismatch', actual: rounded };
  } catch (e) {
    if (e instanceof CheckError || e instanceof SyntaxError) return { status: 'error', detail: { reason: e.message } };
    throw e;
  }
}

export const relFile = (ws, abs) => ws.show(path.resolve(abs));
