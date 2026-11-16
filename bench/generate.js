// Generate the synthetic benchmark: documents, agent-style reports with planted problems, and labels.
// Labels are decided here, by construction (which mutation was applied), not by running the checker.
// Everything is made up. Run: node bench/generate.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'data');
const TOL = 3; // the checker's default tolerance; benign shifts stay within it, wrong lines go beyond it

function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}
const R = rng(20261116);

// ---------- documents ----------
const ZH = {
  people: ['周岚', '韩磊', '许静', '陶一鸣', '王素芬', '李若', '陈航', '赵一凡', '孙晴', '马可'],
  places: ['一号仓库', '北区机房', '三楼会议室', '样品间', '东门岗亭', '二号实验台', '资料室', '南侧走廊'],
  actions: ['检查了温湿度记录', '更换了两只滤芯', '清点了库存', '重新标定了天平', '整理了借阅登记', '补录了上周的数据', '拍了现场照片', '关闭了备用电源', '核对了出入库单', '试运行了新水泵'],
  phrases: ['先别动', '等通知', '已复核', '暂缓处理', '按旧规程', '请勿外借'],
};
const EN = {
  people: ['Avery', 'Jordan', 'Priya', 'Mateo', 'Hana', 'Oskar', 'Lena', 'Tomas', 'Ines', 'Ravi'],
  places: ['north warehouse', 'server room', 'meeting room 3', 'sample store', 'east gate', 'bench 2', 'archive', 'south corridor'],
  actions: ['checked the humidity log', 'replaced two filters', 'counted the stock', 'recalibrated the scale', 'updated the loan register', 'entered last week\'s readings', 'photographed the site', 'switched off the backup supply', 'matched the delivery notes', 'test-ran the new pump'],
  phrases: ['do not move', 'wait for sign-off', 'double-checked', 'on hold', 'old procedure', 'not for loan'],
  months: ['March', 'April', 'May', 'June'],
};

const toWide = (s) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));

function zhLine() {
  const p = R.pick(ZH.people), pl = R.pick(ZH.places), a = R.pick(ZH.actions);
  const n = R.int(3, 98), m = R.int(5, 90), code = `SN-${R.int(1000, 9999)}`;
  const det = R.pick([
    `读数为 ${n}.${R.int(0, 9)}`, `发现 ${R.int(1, 9)} 处缺漏`, `用时 ${m} 分钟`, `编号 ${code}`,
    `编号 ${toWide(code)}`, `备注写着“${R.pick(ZH.phrases)}”`, `结果和上周一致，批次 B${n}`, `需要在 ${R.int(1, 28)} 日前复查`, `已通知${R.pick(ZH.people)}`,
  ]);
  return `${R.int(3, 6)}月${R.int(1, 28)}日，${p}在${pl}${a}，${det}。`;
}

function enLine() {
  const p = R.pick(EN.people), pl = R.pick(EN.places), a = R.pick(EN.actions);
  const n = R.int(3, 98), code = `SN-${R.int(1000, 9999)}`;
  const det = R.pick([
    `the reading was ${n}.${R.int(0, 9)}`, `${R.int(1, 9)} gaps were found`, `it took ${R.int(5, 90)} minutes`, `tag ${code}`,
    `the note said "${R.pick(EN.phrases)}"`, `the note said “${R.pick(EN.phrases)}”`, `same result as last week, batch B${n}`, `recheck due on day ${R.int(1, 28)}`, `${R.pick(EN.people)} was told`,
  ]);
  return `On ${R.pick(EN.months)} ${R.int(1, 28)}, ${p} ${a} in the ${pl}; ${det}.`;
}

const ROUTINE = { zh: '本周例行巡检完成，无异常。', en: 'Routine weekly inspection completed, nothing unusual.' };

/** Build a document: headings, blank lines, normal lines, repeated routine lines, wrapped long lines. */
function makeDoc(lang, n) {
  const lines = [];
  const meta = []; // per line: { kind: 'text'|'wrap1'|'wrap2'|'routine'|'blank'|'head' }
  const gen = lang === 'zh' ? zhLine : enLine;
  let week = 1;
  lines.push(lang === 'zh' ? '# 设备与库房日志（合成数据）' : '# Facilities log (synthetic data)'); meta.push({ kind: 'head' });
  while (lines.length < n) {
    if (lines.length % 14 === 1) {
      lines.push(''); meta.push({ kind: 'blank' });
      lines.push(lang === 'zh' ? `## 第 ${week} 周` : `## Week ${week}`); meta.push({ kind: 'head' });
      week++;
      continue;
    }
    const r = R();
    if (r < 0.07) { lines.push(ROUTINE[lang]); meta.push({ kind: 'routine' }); continue; }
    if (r < 0.17) {
      // one long sentence wrapped over two lines
      const s = gen().replace(/[。.]$/, '') + (lang === 'zh' ? '，' : ', and ') + gen().replace(/^On \w+ \d+, /, '');
      const cut = lang === 'zh' ? R.int(Math.floor(s.length * 0.4), Math.floor(s.length * 0.6)) : s.indexOf(' ', Math.floor(s.length / 2));
      lines.push(s.slice(0, cut).trimEnd()); meta.push({ kind: 'wrap1' });
      lines.push(s.slice(cut).trimStart()); meta.push({ kind: 'wrap2' });
      continue;
    }
    lines.push(gen()); meta.push({ kind: 'text' });
  }
  return { lines, meta };
}

// ---------- CSV ----------
function makeCsv() {
  const cats = ['filters', 'cables', 'labels', 'gloves', 'batteries'];
  const sites = ['north', 'south', 'east'];
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ id: i + 1, site: R.pick(sites), item: R.pick(cats), qty: R.int(1, 40), cost: R.int(100, 99999) / 100 });
  const header = 'id,site,item,qty,cost';
  const body = rows.map((r) => [r.id, r.site, r.item, r.qty, r.cost.toFixed(2)].join(','));
  return { text: [header, ...body].join('\n') + '\n', rows };
}

// ---------- writing ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'workspace'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'reports'), { recursive: true });

const docs = {
  'zh/设备日志_A.md': makeDoc('zh', 220),
  'zh/设备日志_B.md': makeDoc('zh', 160),
  'en/facilities_log_a.md': makeDoc('en', 220),
  'en/facilities_log_b.md': makeDoc('en', 160),
};
for (const [rel, d] of Object.entries(docs)) {
  const abs = path.join(OUT, 'workspace', rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // zh docs use CRLF to exercise line-ending handling
  fs.writeFileSync(abs, d.lines.join(rel.startsWith('zh/') ? '\r\n' : '\n') + '\n');
}
const csv = makeCsv();
fs.writeFileSync(path.join(OUT, 'workspace', 'stock.csv'), csv.text);

// ---------- helpers for building cases ----------
const isZh = (rel) => rel.startsWith('zh/');
const squash = (s) => s.replace(/\s+/g, '');
const narrow = (s) => s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const docText = (rel) => docs[rel].lines.join('\n');
/** true if `q` (in any benign variant) occurs anywhere in the document; used to keep "bad" labels honest */
const occursLoosely = (rel, q) => squash(narrow(docText(rel))).replace(/[“”]/g, '"').includes(squash(narrow(q)).replace(/[“”]/g, '"'));

function quoteFrom(line, zh) {
  // a clause or the whole line, without the final full stop
  const body = line.replace(/[。.]$/, '');
  const parts = body.split(zh ? '，' : /; |, /);
  if (parts.length > 1 && R() < 0.5) {
    const i = R.int(0, parts.length - 1);
    if (parts[i].length >= (zh ? 8 : 18)) return parts[i];
  }
  return body;
}

const textLines = (rel) => docs[rel].meta.map((m, i) => (m.kind === 'text' ? i + 1 : 0)).filter(Boolean);
const lineText = (rel, n) => docs[rel].lines[n - 1];

const fmt = (rel, line, end, quote, zh) => {
  const loc = end && end !== line ? `${line}-${end}` : `${line}`;
  if (quote == null) return `${rel}:${loc}`;
  return zh ? `${rel}:${loc}「${quote}」` : `${rel}:${loc} "${quote}"`;
};

function benign(kind, rel) {
  const zh = isZh(rel);
  const L = textLines(rel);
  const n = R.pick(L);
  const line = lineText(rel, n);
  switch (kind) {
    case 'exact': return { cite: fmt(rel, n, null, quoteFrom(line, zh), zh) };
    case 'width': {
      // flip width of the ASCII part (or narrow an already full-width code)
      const cand = docs[rel].lines.map((l, i) => [l, i + 1]).filter(([l, i]) => docs[rel].meta[i - 1].kind === 'text' && /[A-Za-z0-9０-ｚ]/.test(l));
      const [l, i] = R.pick(cand);
      const q = l.replace(/[。.]$/, '');
      const flipped = /[！-～]/.test(q) ? narrow(q) : q.replace(/[0-9A-Za-z]/g, (c) => (R() < 0.6 ? toWide(c) : c));
      return { cite: fmt(rel, i, null, flipped, zh) };
    }
    case 'quotes': {
      const cand = docs[rel].lines.map((l, i) => [l, i + 1]).filter(([l, i]) => docs[rel].meta[i - 1].kind === 'text' && /[“”"]/.test(l));
      const [l, i] = R.pick(cand);
      const q = l.replace(/[。.]$/, '');
      const sw = /[“”]/.test(q) ? q.replace(/[“”]/g, '"') : q.replace(/"([^"]*)"/, '“$1”');
      return { cite: fmt(rel, i, null, sw, zh), quoteStyle: 'json' };
    }
    case 'spacing': {
      const q = quoteFrom(line, zh);
      const sp = zh ? q.replace(/(\d) /g, '$1').replace(/，/, ' ，') : q.replace(/ /g, () => (R() < 0.15 ? '  ' : ' ')).replace(/^/, ' ');
      return { cite: fmt(rel, n, null, sp, zh) };
    }
    case 'wrapped': {
      const w = docs[rel].meta.map((m, i) => (m.kind === 'wrap1' ? i + 1 : 0)).filter(Boolean);
      const a = R.pick(w);
      const joined = lineText(rel, a) + (zh ? '' : ' ') + lineText(rel, a + 1);
      return { cite: fmt(rel, a, a + 1, joined.replace(/[。.]$/, ''), zh) };
    }
    case 'shift': {
      const k = R.int(1, TOL) * (R() < 0.5 ? -1 : 1);
      const at = Math.min(Math.max(1, n + k), docs[rel].lines.length);
      return { cite: fmt(rel, at, null, quoteFrom(line, zh), zh) };
    }
    case 'duplicate': {
      const rs = docs[rel].meta.map((m, i) => (m.kind === 'routine' ? i + 1 : 0)).filter(Boolean);
      const at = R.pick(rs);
      return { cite: fmt(rel, at, null, ROUTINE[zh ? 'zh' : 'en'].replace(/[。.]$/, ''), zh) };
    }
    default: throw new Error(kind);
  }
}

function bad(kind, rel) {
  const zh = isZh(rel);
  const L = textLines(rel);
  for (let attempt = 0; attempt < 200; attempt++) {
    const n = R.pick(L);
    const line = lineText(rel, n);
    const q = line.replace(/[。.]$/, '');
    let cite = null;
    switch (kind) {
      case 'fake_file': {
        const fake = zh ? R.pick(['zh/设备日志_C.md', 'zh/设备日志.md', 'zh/库房日志_A.md']) : R.pick(['en/facilities_log_c.md', 'en/facility_log_a.md', 'en/log_a.md']);
        cite = fmt(fake, n, null, q, zh); break;
      }
      case 'wrong_line': {
        const k = R.int(TOL + 2, 40) * (R() < 0.5 ? -1 : 1);
        const at = n + k;
        if (at < 1 || at > docs[rel].lines.length) continue;
        cite = fmt(rel, at, null, q, zh); break;
      }
      case 'out_of_range': cite = fmt(rel, docs[rel].lines.length + R.int(5, 80), null, q, zh); break;
      case 'no_quote': cite = fmt(rel, n, null, null, zh); break;
      case 'alter_digit': {
        const ds = [...q.matchAll(/\d/g)];
        if (!ds.length) continue;
        const d = R.pick(ds);
        const nd = String((Number(d[0]) + R.int(1, 8)) % 10);
        const mq = q.slice(0, d.index) + nd + q.slice(d.index + 1);
        if (occursLoosely(rel, mq)) continue;
        cite = fmt(rel, n, null, mq, zh); break;
      }
      case 'alter_name': {
        const names = zh ? ZH.people : EN.people;
        const who = names.find((p) => q.includes(p));
        if (!who) continue;
        const mq = q.replace(who, R.pick(names.filter((p) => p !== who)));
        if (occursLoosely(rel, mq)) continue;
        cite = fmt(rel, n, null, mq, zh); break;
      }
      case 'alter_omit': {
        // drop a few characters / one word from the middle
        let mq;
        if (zh) { const i = R.int(4, Math.max(5, q.length - 6)); mq = q.slice(0, i) + q.slice(i + R.int(2, 4)); }
        else { const w = q.split(' '); if (w.length < 6) continue; w.splice(R.int(2, w.length - 3), 1); mq = w.join(' '); }
        if (occursLoosely(rel, mq)) continue;
        cite = fmt(rel, n, null, mq, zh); break;
      }
      case 'invented': {
        const mq = (zh ? zhLine() : enLine()).replace(/[。.]$/, '');
        if (occursLoosely(rel, mq)) continue;
        cite = fmt(rel, n, null, mq, zh); break;
      }
      case 'neighbor_line': {
        // claims line n says what line n+1 says: verbatim text, but one line off (inside tolerance)
        if (docs[rel].meta[n]?.kind !== 'text') continue;
        cite = fmt(rel, n, null, lineText(rel, n + 1).replace(/[。.]$/, ''), zh); break;
      }
      default: throw new Error(kind);
    }
    return { cite };
  }
  throw new Error(`could not build ${kind}`);
}

// ---------- numbers ----------
const count = (hay, needle) => hay.split(needle).length - 1;
function numberCases(rel) {
  const zh = isZh(rel);
  const text = docText(rel);
  const kw = zh ? R.pick(ZH.places) : R.pick(EN.places);
  const site = R.pick(['north', 'south', 'east']);
  const item = R.pick(['filters', 'cables', 'labels', 'gloves', 'batteries']);
  const rows = csv.rows.filter((r) => r.site === site);
  const qty = rows.reduce((s, r) => s + r.qty, 0);
  const costAll = Math.round(csv.rows.reduce((s, r) => s + r.cost, 0) * 100) / 100;
  const itemQty = csv.rows.filter((r) => r.item === item).reduce((s, r) => s + r.qty, 0);
  const avgCost = csv.rows.filter((r) => r.site === site).reduce((s, r) => s + r.cost, 0) / rows.length;
  const truth = [
    { expr: `count(${rel}, "${kw}")`, value: count(text, kw), kind: 'count' },
    { expr: `lines(${rel})`, value: docs[rel].lines.length, kind: 'lines' },
    { expr: `rows(stock.csv, site=${site})`, value: rows.length, kind: 'rows' },
    { expr: `sum(stock.csv, qty, site=${site})`, value: qty, kind: 'sum' },
    { expr: `sum(stock.csv, cost)`, value: costAll, kind: 'sum_decimal', decimals: 2 },
    { expr: `sum(stock.csv, qty, item=${item})`, value: itemQty, kind: 'sum' },
    { expr: `avg(stock.csv, cost, site=${site})`, value: avgCost, kind: 'avg', decimals: 1 },
  ];
  const out = [];
  for (const t of truth) {
    const show = (v) => (t.decimals ? v.toFixed(t.decimals) : v >= 1000 && R() < 0.5 ? v.toLocaleString('en-US') : String(v));
    if (R() < 0.5) out.push({ text: `\`${t.expr} = ${show(t.value)}\``, label: 'good', category: `num_${t.kind}` });
    else {
      const err = R.pick(t.kind === 'avg' ? [0.5, -0.5, 1.2] : t.decimals ? [1, -0.01, 12.5] : [1, -1, 2, -3, 10]);
      out.push({ text: `\`${t.expr} = ${show(t.value + err)}\``, label: 'bad', category: `num_off_by_${t.kind === 'avg' ? 'rounding' : 'small'}` });
    }
  }
  return out;
}

// ---------- assemble reports ----------
const BENIGN = ['exact', 'width', 'quotes', 'spacing', 'wrapped', 'shift', 'duplicate'];
const BAD = ['fake_file', 'wrong_line', 'out_of_range', 'no_quote', 'alter_digit', 'alter_name', 'alter_omit', 'invented', 'neighbor_line'];
const labels = { generated: 'bench/generate.js', seed: 20261116, tolerance: TOL, reports: [] };
const rels = Object.keys(docs);
const REPORTS = 24;
for (let r = 0; r < REPORTS; r++) {
  const rel = rels[r % rels.length];
  const zh = isZh(rel);
  const cases = [];
  for (const k of BENIGN) for (let j = 0; j < 3; j++) cases.push({ label: 'good', category: k, ...benign(k, rel) });
  for (const k of BAD) for (let j = 0; j < 2; j++) cases.push({ label: 'bad', category: k, ...bad(k, rel) });
  // shuffle
  for (let i = cases.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [cases[i], cases[j]] = [cases[j], cases[i]]; }
  const nums = numberCases(rel);
  const head = zh ? '| 编号 | 出处 |\n|---|---|' : '| # | Source |\n|---|---|';
  const body = cases.map((c, i) => `| ${i + 1} | ${c.cite.replace(/\|/g, '\\|')} |`).join('\n');
  const numHead = zh ? '\n\n## 数字\n' : '\n\n## Numbers\n';
  const md = `${head}\n${body}${numHead}${nums.map((n) => `- ${n.text}`).join('\n')}\n`;
  const name = `report_${String(r + 1).padStart(2, '0')}.md`;
  fs.writeFileSync(path.join(OUT, 'reports', name), md);
  labels.reports.push({
    file: name,
    citations: cases.map((c, i) => ({ id: String(i + 1), label: c.label, category: c.category })),
    numbers: nums.map((n, i) => ({ id: `n${i + 1}`, label: n.label, category: n.category })),
  });
}
fs.writeFileSync(path.join(OUT, 'labels.json'), JSON.stringify(labels, null, 1));
const nC = labels.reports.reduce((s, r) => s + r.citations.length, 0);
const nN = labels.reports.reduce((s, r) => s + r.numbers.length, 0);
console.log(`wrote ${REPORTS} reports, ${nC} citations, ${nN} number claims -> ${path.relative(process.cwd(), OUT)}`);
