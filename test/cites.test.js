import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, statuses } from './helpers.js';
import { normalize } from '../src/text.js';
import { parseReport } from '../src/parse.js';

const NOTES = [
  '# Notes',                                   // 1
  '',                                          // 2
  'The pump was serviced on 12 May.',          // 3
  'Pressure dropped to 1.8 bar after noon.',   // 4
  'Valve B was left open overnight.',          // 5
  'The pump was serviced on 12 May.',          // 6 (duplicate of 3)
  'Night shift logged 3 alarms.',              // 7
  'Long sentence that the editor wrapped',     // 8
  'onto a second line.',                       // 9
].join('\n') + '\n';

const ZH = [
  '# 第三周',                                  // 1
  '仓库第3排货架清点完成，缺 2 箱。',          // 2
  '交接班时“钥匙登记”要先写清楚。',            // 3
  '全角：ＡＢＣ１２３　温度 14.2°C',            // 4
].join('\r\n');

test('normalize folds width, quotes and whitespace', () => {
  assert.equal(normalize('ＡＢＣ１２３　x'), 'ABC123x');
  assert.equal(normalize('“a” ‘b’'), `"a"'b'`);
  assert.equal(normalize(' a\n b\t'), 'ab');
});

test('exact, shifted and wrong-line citations', () => {
  const res = check({ 'notes.md': NOTES }, [
    'notes.md:4 "Pressure dropped to 1.8 bar after noon."',
    'notes.md:6 "Valve B was left open overnight."',
    'notes.md:1 "Night shift logged 3 alarms."',
  ].join('\n'));
  assert.deepEqual(statuses(res), ['ok', 'shifted', 'wrong_line']);
  assert.equal(res.citations.items[1].detail.offset, 1);
  assert.equal(res.citations.items[2].detail.foundAt, 7);
});

test('duplicate lines resolve to the occurrence nearest the cited line', () => {
  const res = check({ 'notes.md': NOTES }, 'notes.md:6 "The pump was serviced on 12 May."');
  assert.equal(res.citations.items[0].status, 'ok');
});

test('altered, invented, missing file, out of range', () => {
  const res = check({ 'notes.md': NOTES }, [
    'notes.md:5 "Valve C was left open overnight."',
    'notes.md:5 "The generator caught fire in the basement."',
    'other.md:5 "Valve B was left open overnight."',
    'notes.md:99 "Valve B was left open overnight."',
  ].join('\n'));
  assert.deepEqual(statuses(res), ['altered', 'not_found', 'missing_file', 'out_of_range']);
  assert.equal(res.citations.items[0].detail.closestLine, 5);
  assert.equal(res.citations.items[3].detail.foundAt, 5);
  assert.equal(res.verdict, 'fail');
});

test('missing or too short excerpts do not pass', () => {
  const res = check({ 'notes.md': NOTES }, 'see notes.md:5 and notes.md:4 "1.8"');
  assert.deepEqual(statuses(res), ['no_quote', 'too_short']);
  const lenient = check({ 'notes.md': NOTES }, 'see notes.md:5', { allowNoQuote: true });
  assert.equal(lenient.verdict, 'pass');
});

test('excerpt spanning a wrapped line', () => {
  const res = check({ 'notes.md': NOTES }, 'notes.md:8-9 "Long sentence that the editor wrapped onto a second line."');
  assert.equal(res.citations.items[0].status, 'ok');
});

test('Chinese: full-width, curly quotes, CRLF, 第N行, glued name', () => {
  const res = check({ '笔记.md': ZH }, [
    '- 笔记.md:2「仓库第3排货架清点完成，缺 2 箱。」',
    '- 见笔记.md:3「交接班时"钥匙登记"要先写清楚」',
    '- 笔记.md 第 4 行「全角：ABC123 温度 14.2°C」',
    '- 笔记.md：2「仓库第3排货架清点完成」',
    '- 笔记.md#L3「交接班时“钥匙登记”不用写清楚」',
  ].join('\n'));
  assert.deepEqual(statuses(res), ['ok', 'ok', 'ok', 'ok', 'altered']);
  assert.equal(res.citations.items[1].resolved, 'glued');
});

test('paths: subfolder suffix, absolute path from elsewhere, backticked name with spaces', () => {
  const res = check({ 'docs/a/notes.md': NOTES, 'my notes.md': NOTES }, [
    'a/notes.md:3 "The pump was serviced on 12 May."',
    'C:\\Users\\someone\\proj\\docs\\a\\notes.md:5 "Valve B was left open overnight."',
    '`my notes.md`:7 "Night shift logged 3 alarms."',
    'see https://example.com:443 for details',
  ].join('\n'));
  assert.deepEqual(statuses(res), ['ok', 'ok', 'ok']);
});

test('JSON citations, brain-dispatch worker report, char ranges', () => {
  const root = { 'notes.md': NOTES };
  const json = JSON.stringify({
    citations: [
      { file: 'notes.md', line: 4, quote: 'Pressure dropped to 1.8 bar' },
      { file: 'notes.md', line: '5-5', excerpt: 'Valve B was left open' },
      { file: 'notes.md', start: NOTES.indexOf('Night'), end: NOTES.indexOf('Night') + 28, quote: 'Night shift logged 3 alarms.' },
    ],
  });
  assert.deepEqual(statuses(check(root, json)), ['ok', 'ok', 'ok']);

  const worker = JSON.stringify({
    status: 'done', summary: 'x', files: [{ path: '/tmp/out.md', what: 'table' }],
    findings: ['Pressure low: notes.md:4 "Pressure dropped to 1.8 bar after noon."', 'no cite here'],
    verified: [], unverified: [], open: [],
  });
  const p = parseReport(worker);
  assert.equal(p.format, 'json');
  assert.equal(p.citations.length, 1);
  assert.equal(p.files[0].path, '/tmp/out.md');
});

test('sampling checks a deterministic subset', () => {
  const report = Array.from({ length: 20 }, () => 'notes.md:4 "Pressure dropped to 1.8 bar after noon."').join('\n');
  const a = check({ 'notes.md': NOTES }, report, { sample: '25%', seed: 7 });
  const b = check({ 'notes.md': NOTES }, report, { sample: '25%', seed: 7 });
  assert.equal(a.citations.checked, 5);
  assert.equal(a.citations.total, 20);
  assert.deepEqual(a.citations.items.map((i) => i.id), b.citations.items.map((i) => i.id));
});

test('empty report fails unless allowed', () => {
  assert.equal(check({ 'notes.md': NOTES }, 'nothing to see').verdict, 'fail');
  assert.equal(check({ 'notes.md': NOTES }, 'nothing to see', { allowEmpty: true }).verdict, 'pass');
});

// --- fixes from the 0.1.1 code review ---

test('a cited range must lie inside the file and be in order', () => {
  const files = { 'one.md': 'alpha beta gamma delta\n' };
  assert.deepEqual(statuses(check(files, '- one.md:1-999 "alpha beta"')), ['out_of_range']);
  assert.deepEqual(statuses(check(files, '- one.md:1 "alpha beta"')), ['ok']);
  const json = (c) => JSON.stringify({ citations: [{ file: 'one.md', ...c }] });
  // character ranges: negative or past-the-end offsets are not silently clamped
  assert.deepEqual(statuses(check(files, json({ start: -12, end: 100, quote: 'gamma delta' }))), ['out_of_range']);
  assert.deepEqual(statuses(check(files, json({ start: 6, end: 2, quote: 'gamma delta' }))), ['out_of_range']);
  assert.deepEqual(statuses(check(files, json({ start: 11, end: 22, quote: 'gamma delta' }))), ['ok']);
  // no excerpt: start line past the end, or end before start
  const res = check(files, json({ line: 999, end_line: 1 }), { allowNoQuote: true });
  assert.deepEqual(statuses(res), ['out_of_range']);
  assert.equal(res.verdict, 'fail');
  assert.deepEqual(statuses(check({ 'empty.txt': '' }, json({ file: 'empty.txt', line: 1 }).replace('one.md', 'empty.txt'), { allowNoQuote: true })), ['out_of_range']);
});

test('a repeated excerpt is matched at the nearest place, however many times it occurs', () => {
  const files = { 'log.md': 'Routine inspection completed.\n'.repeat(2000) };
  const res = check(files, '- log.md:2000 "Routine inspection completed."\n- log.md:1500 "Routine inspection completed."');
  assert.deepEqual(statuses(res), ['ok', 'ok']);
  assert.equal(check(files, '- log.md:3000 "Routine inspection completed."').citations.items[0].detail.occurrences, 2000);
});

test('files without an extension are checked when an excerpt follows', () => {
  const files = {
    'notes.md': 'The pump was serviced on 12 May.\n',
    Dockerfile: 'FROM base\nRUN make all\n',
    '.env': 'PORT=8080\n',
    'bin/tool': '#!/bin/sh\necho hello world\n',
  };
  const res = check(files, [
    '- notes.md:1 "The pump was serviced on 12 May."',
    '- Dockerfile:2 "RUN make everything"',
    '- .env:1 "PORT=8080"',
    '- `bin/tool`:2 "echo hello world"',
  ].join('\n'));
  assert.deepEqual(res.citations.items.map((i) => [i.file, i.status]), [
    ['notes.md', 'ok'], ['Dockerfile', 'not_found'], ['.env', 'ok'], ['bin/tool', 'ok'],
  ]);
  assert.equal(res.verdict, 'fail');
  // prose without an excerpt is not a citation
  assert.equal(parseReport('README: 3 sections. VERSION: 2. `count`: 3 items. LICENSE:1').citations.length, 0);
});

test('a straight quote inside the excerpt followed by spaces does not end it', () => {
  const files = { 'n.md': 'The label is "alpha"   and count is 10.\n' };
  assert.deepEqual(statuses(check(files, '- n.md:1 "The label is "alpha"   and count is 99."')), ['altered']);
  assert.deepEqual(statuses(check(files, '- n.md:1 "The label is "alpha"   and count is 10."')), ['ok']);
  assert.deepEqual(statuses(check(files, '| 1 | n.md:1 "The label is "alpha"   and count is 10." |')), ['ok']);
  assert.deepEqual(statuses(check(files, '| 1 | n.md:1 "The label is "alpha"   and count is 99." |')), ['altered']);
});
