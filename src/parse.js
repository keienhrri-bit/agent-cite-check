// Parse an agent report (Markdown/plain text or JSON) into citations, number claims and file claims.

const BT = '`';
const EXT = String.raw`\.(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{1,10}`;
const PATHCH = String.raw`[^\s:：「」『』“”"'<>|()（）\[\]{}，。；;,、*?!！？${BT}]`;
const PATH = String.raw`(?:(?<![A-Za-z])[A-Za-z]:[\\/])?${PATHCH}+?${EXT}`;
const LINE =
  String.raw`(?:[:：]\s*L?(?<a1>\d+)(?:\s*[-–—~～]\s*L?(?<b1>\d+))?(?![\d.]*\d)` +
  String.raw`|#L(?<a2>\d+)(?:-L?(?<b2>\d+))?` +
  String.raw`|\s*第\s*(?<a3>\d+)\s*(?:[-–—~～至到]\s*第?\s*(?<b3>\d+)\s*)?行)`;
// Extensionless names require an excerpt and a tight line specifier.
const BARE = 'Dockerfile|Containerfile|Makefile|GNUmakefile|Justfile|Jenkinsfile|Vagrantfile|Procfile|Gemfile|Rakefile|Brewfile|LICENSE|LICENCE|COPYING|NOTICE|AUTHORS|CODEOWNERS|README|CHANGELOG|VERSION';
const NAME = String.raw`(?:${BARE}|\.[A-Za-z0-9_][\w-]*)`;
const NOEXT = String.raw`(?<!${PATHCH})(?:[A-Za-z]:[\\/])?(?:${PATHCH}*[\\/])?${NAME}`;
const NBP = String.raw`[^${BT}\r\n]+`;
const CITE_RE = new RegExp(
  String.raw`(?:${BT}(?<bp>[^${BT}\n]+?${EXT})${BT}|(?<p>${PATH})|${BT}(?<nbp>${NBP})${BT}|(?<np>${NOEXT}))${LINE}`,
  'gu',
);

const QUOTE_PAIRS = { '「': '」', '『': '』', '“': '”', '"': '"', '«': '»' };

const OPS = 'lines|count|lines_with|files|rows|sum|avg|min|max|distinct';
// The claimed value is read whole: digits, separators and exponents up to the first other
// character. Sentence punctuation at its end is dropped; whether the rest is a valid number is
// decided when the claim is checked, so a malformed value ("1e2e3", "1.2.3") fails its item.
const NUM_RE = new RegExp(
  String.raw`${BT}?\b(?<op>${OPS})\((?<args>[^${BT}\n]*?)\)\s*={1,2}\s*(?<val>[-+]?(?:[\d.,]|(?<=\d)[eE][-+]?)*%?)${BT}?`,
  'g',
);

const FILE_RE = /^\s*(?:[-*]\s+)?\[(?<kind>[+~-])\]\s+(?<rest>.+?)\s*$/;

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Read the excerpt that directly follows a citation, if any. */
function quoteAfter(text, pos) {
  let i = pos;
  if (text[i] === BT) i++;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  if (/[-—–:：]/.test(text[i] || '') && !/\d/.test(text[i + 1] || '')) {
    i++;
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  }
  const open = text[i];
  const close = QUOTE_PAIRS[open];
  if (!close) return null;
  const fragment = text.slice(i + 1, i + 2001).split('\n', 1)[0];
  let offset = fragment.indexOf(close);
  if (offset < 0) return null;
  if (open === '"') {
    // the limit bounds where the closing quote may be, not the spaces that follow it
    const limit = i + 1 + fragment.length;
    const completeLine = limit === text.length || text[limit] === '\n';
    const first = offset;
    offset = -1;
    for (let j = first; j >= 0; j = fragment.indexOf(close, j + 1)) {
      let k = i + j + 2;
      while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
      if (k === text.length || /[\n|,;，；)）\]]/.test(text[k]) || text.startsWith('\\|', k)) {
        offset = j;
        break;
      }
    }
    if (offset === -1) {
      if (!completeLine) return null;
      offset = first; // Inline prose can follow a closed excerpt on the same line.
    }
  }
  const end = i + 1 + offset;
  return { quote: text.slice(i + 1, end).replace(/\\\|/g, '|'), end: end + 1 };
}

/** Parse citations, number claims and file claims out of free text. */
export function parseText(text, { source = 'report', baseLine = 0 } = {}) {
  text = text.replace(/\r\n?/g, '\n');
  const citations = [];
  const numbers = [];
  const files = [];

  for (const m of text.matchAll(NUM_RE)) {
    const val = m.groups.val.replace(/[.,]+$/, '');
    if (!/\d/.test(val)) continue;
    numbers.push({
      at: `${source}:${baseLine + lineOf(text, m.index)}`,
      expr: `${m.groups.op}(${m.groups.args})`,
      op: m.groups.op,
      args: m.groups.args,
      claimed: val,
    });
  }

  for (const m of text.matchAll(CITE_RE)) {
    const g = m.groups;
    const file = g.bp ?? g.p ?? g.nbp ?? g.np;
    const before = text.slice(Math.max(0, m.index - 3), m.index);
    if ((file.startsWith('//') && text[m.index - 1] === ':') || /:\/\/?$|\/\/$/.test(before) || file.includes('://')) continue; // URL
    const a = Number(g.a1 ?? g.a2 ?? g.a3);
    const b = Number(g.b1 ?? g.b2 ?? g.b3 ?? a);
    const q = quoteAfter(text, m.index + m[0].length);
    if (g.nbp != null || g.np != null) {
      // extensionless names need an excerpt, and "name:12" written tight, not "key: 12"
      const lineSpec = m[0].slice(file.length + (g.nbp != null ? 2 : 0));
      if (!q || /^[:：]\s/.test(lineSpec)) continue;
    }
    citations.push({
      at: `${source}:${baseLine + lineOf(text, m.index)}`,
      raw: text.slice(m.index, q ? q.end : m.index + m[0].length).trim(),
      file,
      line: a,
      endLine: b,
      quote: q ? q.quote : null,
    });
  }

  const lines = text.split(/\r?\n/);
  lines.forEach((ln, i) => {
    const m = FILE_RE.exec(ln);
    if (!m) return;
    const rest = m.groups.rest;
    const bt = new RegExp(`^${BT}([^${BT}]+)${BT}`).exec(rest);
    const p = bt ? bt[1] : rest.split(/\s+/)[0];
    const change = { '+': 'added', '~': 'modified', '-': 'deleted' }[m.groups.kind];
    files.push({ at: `${source}:${baseLine + i + 1}`, path: p, change });
  });

  return { citations, numbers, files };
}

function toLine(v) {
  if (typeof v === 'number') return [v, v];
  if (typeof v === 'string') {
    const m = /^\s*L?(\d+)(?:\s*[-–~]\s*L?(\d+))?\s*$/.exec(v);
    if (m) return [Number(m[1]), Number(m[2] ?? m[1])];
  }
  return [null, null];
}

/** Structured citation object from JSON. */
function jsonCitation(o, at) {
  const file = o.file ?? o.path ?? o.source;
  const [a, b] = toLine(o.line ?? o.lines);
  const end = o.end_line ?? o.endLine;
  const quote = o.quote ?? o.excerpt ?? o.text ?? null;
  const c = {
    at,
    raw: `${file}${a ? ':' + a : ''}`,
    file,
    line: a,
    endLine: end != null ? Number(end) : b,
    quote: quote == null ? null : String(quote),
  };
  if (o.start != null && o.end != null) { c.start = Number(o.start); c.end = Number(o.end); c.raw = `${file}@${c.start}-${c.end}`; }
  if (o.id != null) c.label = String(o.id);
  return c;
}

/**
 * Parse a report. JSON reports may be:
 *  - { citations: [...], numbers: [...], files: [...], findings: [...] }   (findings are parsed as text;
 *    this also covers the brain-dispatch worker report: files[].path + findings[])
 *  - an array of citation objects / number objects / strings
 * Anything else is treated as text.
 */
export function parseReport(content, source = 'report') {
  const trimmed = content.replace(/^﻿/, '').trim();
  let data = null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { data = JSON.parse(trimmed); } catch { data = null; }
  }
  if (data === null || typeof data !== 'object') return { format: 'text', ...parseText(content, { source }) };

  const out = { format: 'json', citations: [], numbers: [], files: [] };
  const addText = (s, at) => {
    const r = parseText(String(s), { source: at });
    for (const c of r.citations) c.at = at;
    for (const n of r.numbers) n.at = at;
    out.citations.push(...r.citations);
    out.numbers.push(...r.numbers);
  };
  const addItem = (it, at) => {
    if (typeof it === 'string') return addText(it, at);
    if (!it || typeof it !== 'object') return;
    if (it.expr) {
      const m = /^\s*(\w+)\((.*)\)\s*$/.exec(String(it.expr));
      if (m) out.numbers.push({ at, expr: `${m[1]}(${m[2]})`, op: m[1], args: m[2], claimed: String(it.claim ?? it.value ?? '') });
      return;
    }
    if (it.file || it.path || it.source) out.citations.push(jsonCitation(it, at));
  };
  if (Array.isArray(data)) data.forEach((it, i) => addItem(it, `${source}[${i}]`));
  else {
    (data.citations ?? []).forEach((it, i) => addItem(it, `${source}.citations[${i}]`));
    (data.numbers ?? []).forEach((it, i) => addItem(it, `${source}.numbers[${i}]`));
    (data.findings ?? []).forEach((it, i) => addItem(it, `${source}.findings[${i}]`));
    (data.items ?? data.rows ?? []).forEach((it, i) => addItem(it, `${source}.items[${i}]`));
    const map = { '+': 'added', '~': 'modified', '-': 'deleted', created: 'added', new: 'added', changed: 'modified', removed: 'deleted' };
    (data.files ?? []).forEach((f, i) => {
      const at = `${source}.files[${i}]`;
      if (typeof f === 'string') out.files.push({ at, path: f, change: null });
      else if (f && (f.path || f.file)) {
        const ch = f.change ?? f.kind ?? null;
        out.files.push({ at, path: f.path ?? f.file, change: ch ? (map[ch] ?? ch) : null });
      }
    });
  }
  return out;
}
