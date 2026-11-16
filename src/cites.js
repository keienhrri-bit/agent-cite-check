// Check citations: does the file exist, and is the excerpt really at (or near) the cited line?
import { normalize, bestWindow } from './text.js';
import { lineAt } from './workspace.js';

export const CITE_PASS = new Set(['ok', 'shifted']);

/** Find every occurrence of normalized `q` in the document; returns [{ from, to }] in 1-based lines. */
function occurrences(doc, q) {
  const out = [];
  let i = doc.joined.indexOf(q);
  while (i >= 0 && out.length < 1000) {
    out.push({ from: lineAt(doc, i), to: lineAt(doc, i + q.length - 1) });
    i = doc.joined.indexOf(q, i + 1);
  }
  return out;
}

const offsetOf = (occ, a, b) => Math.max(a - occ.from, occ.to - b, 0);

/** Normalized text of lines [from, to] (1-based, clamped). */
function slice(doc, from, to) {
  const f = Math.max(1, from), t = Math.min(doc.lines.length, to);
  if (t < f) return { text: '', start: 0 };
  return { text: doc.norm.slice(f - 1, t).join(''), start: doc.offs[f - 1] };
}

/** Closest near-match of q around lines [from, to]. */
function nearest(doc, q, from, to) {
  const s = slice(doc, from, to);
  const w = bestWindow(q, s.text);
  if (w.index < 0) return null;
  // the window may start inside the previous line; report the line holding most of it
  const line = lineAt(doc, s.start + w.index + Math.floor(q.length / 2));
  return { score: w.score, line, text: doc.lines[line - 1].trim() };
}

function checkOne(c, doc, opts) {
  const { tolerance, minQuote, nearThreshold } = opts;
  const n = doc.lines.length;
  const a = c.line, b = c.endLine ?? c.line;
  const base = {};
  if (c.quote == null) {
    if (!a || a < 1 || b > n) return { status: 'out_of_range', detail: { lines: n } };
    return { status: 'no_quote' };
  }
  const q = normalize(c.quote);
  if (q.length < minQuote) return { status: 'too_short', detail: { length: q.length, min: minQuote } };

  // character-range citations (JSON form): exact span check
  if (c.start != null && c.end != null) {
    const span = normalize(doc.text.slice(c.start, c.end));
    if (span.includes(q)) return { status: 'ok' };
    const raw = doc.text.indexOf(c.quote);
    return raw >= 0
      ? { status: 'wrong_line', detail: { foundAt: raw, unit: 'char' } }
      : { status: 'not_found' };
  }

  if (!a || a < 1) return { status: 'out_of_range', detail: { lines: n } };
  const occ = occurrences(doc, q);
  if (occ.length) {
    occ.sort((x, y) => offsetOf(x, a, b) - offsetOf(y, a, b) || x.from - y.from);
    const best = occ[0];
    const off = offsetOf(best, a, b);
    const where = { foundAt: best.from === best.to ? best.from : `${best.from}-${best.to}`, offset: off, occurrences: occ.length };
    if (a > n) return { status: 'out_of_range', detail: { lines: n, ...where } };
    if (off === 0) return { status: 'ok', ...base };
    if (off <= tolerance) return { status: 'shifted', detail: where };
    return { status: 'wrong_line', detail: where };
  }
  if (a > n) return { status: 'out_of_range', detail: { lines: n } };

  // not found verbatim anywhere: was it altered (close text near the cited line) or invented?
  const near = nearest(doc, q, a - tolerance, b + tolerance);
  if (near && near.score >= nearThreshold) {
    return { status: 'altered', detail: { closestLine: near.line, similarity: round2(near.score), closest: near.text } };
  }
  const far = nearest(doc, q, 1, n);
  if (far && far.score >= nearThreshold) {
    return { status: 'altered', detail: { closestLine: far.line, similarity: round2(far.score), closest: far.text, far: true } };
  }
  return { status: 'not_found', detail: near ? { closestLine: near.line, similarity: round2(near.score) } : undefined };
}

const round2 = (x) => Math.round(x * 100) / 100;

/** Verify one citation against the workspace. */
export function verifyCitation(c, ws, opts) {
  if (!c.file) return { status: 'missing_file', detail: { reason: 'no file' } };
  const r = ws.resolve(c.file);
  if (!r.abs.length) return { status: 'missing_file' };
  const results = [];
  for (const abs of r.abs) {
    const doc = ws.load(abs);
    if (doc.error) { results.push({ file: ws.show(abs), status: 'unreadable', detail: { reason: doc.error } }); continue; }
    results.push({ file: ws.show(abs), ...checkOne(c, doc, opts) });
  }
  const rank = { ok: 0, shifted: 1, wrong_line: 2, altered: 3, no_quote: 4, too_short: 5, not_found: 6, out_of_range: 7, unreadable: 8 };
  results.sort((x, y) => rank[x.status] - rank[y.status]);
  const best = results[0];
  if (r.how !== 'exact') best.resolved = r.how;
  if (r.abs.length > 1) best.candidates = results.map((x) => x.file);
  return best;
}
