// Short human summary of a result, in Chinese or English.
import { minOf, maxOf } from './workspace.js';

const T = {
  zh: {
    pass: '通过', fail: (n) => `不通过（${n} 项问题）`, empty: '回报里没找到可核对的出处、数字或改动',
    cites: (t, ok, sh) => `出处 ${t} 条：${ok} 条对得上${sh ? `（其中 ${sh} 条行号偏了 ${'$R'} 行）` : ''}`,
    sampled: (k, t) => `（抽查 ${k}/${t} 条）`,
    bad: (n) => `，${n} 条不符`,
    numbers: (t, ok) => `数字 ${t} 条：${ok} 条重算一致`,
    numBad: (n) => `，${n} 条不符`,
    changes: (t, ok) => `改动 ${t} 处：${ok} 处和回报一致`,
    chBad: (n) => `，${n} 处有问题`,
    more: (n) => `  …另有 ${n} 条`,
    s: {
      missing_file: (d) => (d.reason === 'outside_root' ? '路径在 --root 之外，没有打开' : '文件不存在'),
      out_of_range: (d) => `行号越界（文件只有 ${d.lines} 行）${d.foundAt ? `，摘录其实在第 ${d.foundAt} 行` : ''}`,
      wrong_line: (d) => `摘录在第 ${d.foundAt} 行，离所引行 ${d.offset} 行`,
      altered: (d) => `摘录被改过：最接近的是第 ${d.closestLine} 行（相似度 ${d.similarity}）「${d.closest}」`,
      not_found: () => '摘录在文件里找不到',
      no_quote: () => '没带逐字摘录',
      too_short: (d) => `摘录太短（${d.length} 字，至少 ${d.min} 字）`,
      unreadable: (d) => (d.reason === 'outside_root' ? '链接指向 --root 之外，没有打开' : `文件读不了（${d.reason}）`),
    },
    num: {
      mismatch: (n) => `声明 ${n.claimed}，重算 ${n.actual}`,
      error: (n) => `算不了：${n.detail.reason}`,
    },
    ch: {
      unreported: () => '回报没提到',
      phantom: (c) => (c.outside ? '回报列了 --root 之外的路径' : c.unreadable ? '回报列了，但路径查不了（没有权限或链接循环）' : c.exists ? '回报说改了，实际没变' : '回报列了，文件不存在'),
      forbidden: () => '改了不该改的文件',
      kind_differs: (c) => `回报写的是 ${c.reported}，实际是 ${c.change}`,
    },
  },
  en: {
    pass: 'PASS', fail: (n) => `FAIL (${n} problem${n === 1 ? '' : 's'})`, empty: 'no citations, numbers or file changes found to check',
    cites: (t, ok, sh) => `Citations ${t}: ${ok} match${sh ? ` (${sh} off by ${'$R'} line${'$S'})` : ''}`,
    sampled: (k, t) => ` (sampled ${k}/${t})`,
    bad: (n) => `, ${n} do not`,
    numbers: (t, ok) => `Numbers ${t}: ${ok} recompute to the same value`,
    numBad: (n) => `, ${n} do not`,
    changes: (t, ok) => `File changes ${t}: ${ok} match the report`,
    chBad: (n) => `, ${n} do not`,
    more: (n) => `  … ${n} more`,
    s: {
      missing_file: (d) => (d.reason === 'outside_root' ? 'path is outside --root; not opened' : 'file does not exist'),
      out_of_range: (d) => `line out of range (file has ${d.lines} lines)${d.foundAt ? `; the excerpt is at line ${d.foundAt}` : ''}`,
      wrong_line: (d) => `excerpt is at line ${d.foundAt}, ${d.offset} lines from the cited line`,
      altered: (d) => `excerpt was changed; closest is line ${d.closestLine} (similarity ${d.similarity}) "${d.closest}"`,
      not_found: () => 'excerpt not found in the file',
      no_quote: () => 'no verbatim excerpt',
      too_short: (d) => `excerpt too short (${d.length} chars, need ${d.min})`,
      unreadable: (d) => (d.reason === 'outside_root' ? 'link points outside --root; not opened' : `cannot read file (${d.reason})`),
    },
    num: {
      mismatch: (n) => `claimed ${n.claimed}, recomputed ${n.actual}`,
      error: (n) => `cannot compute: ${n.detail.reason}`,
    },
    ch: {
      unreported: () => 'not in the report',
      phantom: (c) => (c.outside ? 'reported a path outside --root' : c.unreadable ? 'reported, but the path cannot be looked up (no permission or a link loop)' : c.exists ? 'reported as changed, but unchanged' : 'reported, but the file does not exist'),
      forbidden: () => 'changed a file outside the allowed area',
      kind_differs: (c) => `reported as ${c.reported}, actually ${c.change}`,
    },
  },
};

const MAX_LIST = 10;
const SIGN = { added: '+', modified: '~', deleted: '-' };

function clip(s, n = 40) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function summarize(res, lang = 'en') {
  const t = T[lang] ?? T.en;
  const out = [];
  out.push(`agent-cite-check: ${res.verdict === 'pass' ? t.pass : res.empty ? `${t.fail(1)} — ${t.empty}` : t.fail(res.failures)}`);

  const c = res.citations;
  if (c.total) {
    const shifted = c.items.filter((i) => i.status === 'shifted');
    const offs = shifted.map((i) => i.detail.offset);
    const lo = minOf(offs), hi = maxOf(offs);
    const range = offs.length ? (lo === hi ? `${lo}` : `${lo}–${hi}`) : '';
    let line = t.cites(c.total, c.passed, shifted.length).replace('$R', range).replace('$S', range === '1' ? '' : 's');
    if (c.checked < c.total) line = line.replace(/[:：]/, (m) => t.sampled(c.checked, c.total) + m);
    if (c.failed) line += t.bad(c.failed);
    out.push(line);
    const bad = c.items.filter((i) => !i.pass);
    for (const i of bad.slice(0, MAX_LIST)) {
      const d = i.detail ?? {};
      if (i.status === 'altered') d.closest = clip(d.closest);
      out.push(`  #${i.id} ${clip(i.raw, 60)} — ${t.s[i.status](d)}`);
    }
    if (bad.length > MAX_LIST) out.push(t.more(bad.length - MAX_LIST));
  }

  const n = res.numbers;
  if (n.total) {
    let line = t.numbers(n.total, n.passed);
    if (n.failed) line += t.numBad(n.failed);
    out.push(line);
    const bad = n.items.filter((i) => !i.pass);
    for (const i of bad.slice(0, MAX_LIST)) out.push(`  ${i.id} ${clip(i.expr, 60)} — ${t.num[i.status](i)}`);
    if (bad.length > MAX_LIST) out.push(t.more(bad.length - MAX_LIST));
  }

  const ch = res.changes;
  if (ch && ch.items.length) {
    let line = t.changes(ch.items.length, ch.passed);
    if (ch.failed) line += t.chBad(ch.failed);
    out.push(line);
    const bad = ch.items.filter((i) => i.status !== 'ok');
    for (const i of bad.slice(0, MAX_LIST)) out.push(`  ${SIGN[i.change] ?? '?'} ${i.path} — ${t.ch[i.status](i)}`);
    if (bad.length > MAX_LIST) out.push(t.more(bad.length - MAX_LIST));
  }
  return out.join('\n');
}
