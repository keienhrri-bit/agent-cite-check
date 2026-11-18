// Recompute declared numbers: lines(), count(), lines_with(), files(), rows(), sum(), avg(), min(), max(), distinct().
import path from 'node:path';
import vm from 'node:vm';
import { fold, isGlob } from './text.js';
import { minOf, maxOf, isUnc } from './workspace.js';

/** A /regex/ from a report runs under this time limit (ms); a pattern that backtracks forever fails the item. */
export const REGEX_TIMEOUT_MS = 5000;

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

/** Split conditions on " and " outside "quotes": name="Research and Development" stays one condition. */
function splitAnd(s) {
  const out = [];
  const AND = /\s+and\s+/iy;
  let cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === '“' || c === '「') {
      q = c === '"' ? '"' : c === '“' ? '”' : '」';
      cur += c;
      continue;
    }
    AND.lastIndex = i;
    const m = AND.exec(s);
    if (m) { out.push(cur); cur = ''; i += m[0].length - 1; continue; }
    cur += c;
  }
  out.push(cur);
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

// Runs a report's regex in a separate context with a time limit: V8 interrupts the match itself.
const REGEX_SCRIPT = new vm.Script(`(() => {
  const re = new RegExp(source, flags);
  let n = 0;
  if (mode === 'count') {
    for (const t of texts) { re.lastIndex = 0; for (const _ of t.matchAll(re)) n++; }
  } else {
    for (const lines of texts) for (const ln of lines) { re.lastIndex = 0; if (re.test(ln)) n++; }
  }
  return n;
})()`);

function runRegex(re, mode, texts, timeout) {
  const ctx = vm.createContext({ source: re.source, flags: re.flags, mode, texts });
  try {
    return REGEX_SCRIPT.runInContext(ctx, { timeout });
  } catch (e) {
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new CheckError(`regular expression ${re} did not finish within ${timeout / 1000} s`);
    }
    throw new CheckError(`regular expression ${re} failed: ${e && e.message}`);
  }
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

/** Parse a number as people write it: "1,234", "81.5", "12%", " 3 ", "1e3". Returns NaN when not numeric. */
export function toNumber(v) {
  if (v == null) return NaN;
  let s = fold(String(v)).trim().replace(/%$/, '');
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  return Number(s);
}

/** Decimal places a claim is written to: "81.5" → 1, "1.5e-3" → 4, "1e3" → 0. */
function decimalsOf(str) {
  const s = fold(String(str)).trim().replace(/%$/, '');
  const m = /^[-+]?[\d,]*(?:\.(\d*))?(?:e([-+]?\d+))?$/i.exec(s);
  if (!m) return 0;
  return Math.max(0, (m[1]?.length ?? 0) - Number(m[2] ?? 0));
}

/** Delimiter with the most occurrences outside quotes on the first record (comma on a tie). */
function sniffDelimiter(text) {
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { inQ = !inQ; continue; } // an escaped "" flips twice
    if (inQ) continue;
    if (c === '\n' || c === '\r') break;
    if (c in counts) counts[c]++;
  }
  let best = ',';
  for (const d of [',', '\t', ';']) if (counts[d] > counts[best]) best = d;
  return best;
}

/** Minimal RFC 4180 CSV parser; delimiter sniffed from the first record (comma, tab, semicolon). */
export function parseCsv(text, file = '') {
  text = text.replace(/^\uFEFF/, '');
  const delim = /\.tsv$/i.test(file) ? '\t' : sniffDelimiter(text);
  const rows = [];
  // `touched`: the record has a delimiter or quotes, so ",," is a record of empty fields, not a blank line
  let row = [], cell = '', inQ = false, touched = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += c;
    } else if (c === '"' && cell === '') { inQ = true; touched = true; }
    else if (c === delim) { row.push(cell); cell = ''; touched = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (touched || row.some((x) => x !== '')) rows.push(row);
      row = []; touched = false;
    } else cell += c;
  }
  row.push(cell);
  if (touched || row.some((x) => x !== '')) rows.push(row);
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
  if (isUnc(arg.replace(/^["“「]/, ''))) throw new CheckError('outside the root folder: ' + arg);
  const p = unquote(arg) ?? arg.replace(/^`|`$/g, '');
  if (isUnc(p)) throw new CheckError(`outside the root folder: ${p}`);
  if (isGlob(p)) {
    const files = ws.glob(p);
    return { files, glob: true };
  }
  const r = ws.resolve(p);
  if (!r.abs.length) throw new CheckError(r.how === 'outside' ? `outside the root folder: ${p}` : `file not found: ${p}`);
  if (r.abs.length > 1) throw new CheckError(`ambiguous file name: ${p} (${r.abs.map((a) => ws.show(a)).join(', ')})`);
  return { files: r.abs, glob: false };
}

function loadText(ws, abs) {
  const doc = ws.load(abs);
  if (doc.error) throw new CheckError(`cannot read ${ws.show(abs)}: ${doc.error}`);
  return doc;
}

/** Compute the actual value of a declared expression. */
export function evaluate(n, ws, opts = {}) {
  const regexTimeout = opts.regexTimeout ?? REGEX_TIMEOUT_MS;
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
    const docs = files.map((f) => loadText(ws, f));
    if (re) return runRegex(re, op, docs.map((d) => (op === 'count' ? d.text : d.lines)), regexTimeout);
    let total = 0;
    const needle = fold(lit);
    for (const doc of docs) {
      if (op === 'count') total += countLiteral(fold(doc.text), needle);
      else for (const ln of doc.lines) if (fold(ln).includes(needle)) total++;
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
  const conds = condArgs.flatMap(splitAnd).map((a) => {
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
  if (op === 'min') return minOf(nums);
  if (op === 'max') return maxOf(nums);
  throw new CheckError(`unknown operation ${op}`);
}

/**
 * Compare at the precision the agent wrote. Whole numbers must match exactly (only float noise
 * from summing decimals is forgiven). "81.5", and avg() at any precision, must be a rounding of
 * the actual value: within half a unit of the last digit written.
 */
export function sameNumber(claimedStr, actual, op) {
  const claimed = toNumber(claimedStr);
  if (!Number.isFinite(claimed) || !Number.isFinite(actual)) return false;
  const mantissa = String(claimedStr).split(/e/i, 1)[0];
  if (claimed === 0 && /[1-9]/.test(mantissa)) return false;
  const dec = decimalsOf(claimedStr);
  if (!dec && op !== 'avg') {
    if (Number.isInteger(actual)) return actual === claimed;
    // Preserve the allowance for addition noise, bounded below one integer step.
    return Math.abs(actual - claimed) <= Math.min(1e-9, Number.EPSILON * Math.abs(claimed));
  }
  const [mant, exponent = '0'] = Math.abs(actual).toString().split('e');
  const places = (mant.split('.')[1]?.length ?? 0) - Number(exponent);
  if (dec >= places) return actual === claimed;
  // Round decimal digits directly: multiplying binary floats by a power of ten
  // can move a value to the other side of a decimal midpoint.
  const coefficient = BigInt(mant.replace('.', ''));
  const divisor = 10n ** BigInt(places - dec);
  const rounded = (coefficient + divisor / 2n) / divisor;
  return Math.sign(actual) * Number(rounded + 'e-' + dec) === claimed;
}

export function verifyNumber(n, ws, opts = {}) {
  if (!/\d/.test(n.claimed ?? '')) return { status: 'error', detail: { reason: 'no claimed value' } };
  try {
    const actual = evaluate(n, ws, opts);
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
