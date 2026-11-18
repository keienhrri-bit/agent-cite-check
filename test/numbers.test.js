import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { check } from './helpers.js';
import { parseCsv, splitArgs, sameNumber } from '../src/numbers.js';

const FILES = {
  'log.md': 'TODO one\nok\nTODO two TODO\nＴＯＤＯ wide\n',
  'data/scores.csv': 'name,subject,score\nAnn,physics,81\nBo,math,"1,200"\n"Lee, C",physics,77.5\nDan,chem,n/a\n',
  'data/more.csv': 'name,subject,score\nEve,physics,90\n',
  'notes/a.md': 'x\n',
  'notes/b.md': 'y\nz\n',
};

const nums = (report) => check(FILES, report).numbers.items;

test('splitArgs keeps quoted commas and regexes', () => {
  assert.deepEqual(splitArgs('a.csv, "x, y", /a,b/i, col=1'), ['a.csv', '"x, y"', '/a,b/i', 'col=1']);
});

test('parseCsv handles quotes and BOM', () => {
  const { header, rows } = parseCsv('﻿a,b\n"1,2",x\n', 'f.csv');
  assert.deepEqual(header, ['a', 'b']);
  assert.deepEqual(rows, [['1,2', 'x']]);
});

test('text counts', () => {
  const r = nums([
    '`count(log.md, "TODO") = 4`',     // full-width ＴＯＤＯ folds to TODO
    '`lines_with(log.md, "TODO") = 3`',
    '`count(log.md, /^TODO/gm) = 2`',
    '`lines(log.md) = 4`',
    '`lines(log.md) = 5`',
  ].join('\n'));
  assert.deepEqual(r.map((x) => x.status), ['ok', 'ok', 'ok', 'ok', 'mismatch']);
  assert.equal(r[4].actual, 4);
});

test('CSV rows, sums, filters', () => {
  const r = nums([
    '`rows(data/scores.csv) = 4`',
    '`rows(scores.csv, subject=physics) = 2`',
    '`sum(data/scores.csv, score) = 1358.5`',
    '`sum(data/scores.csv, score, subject=physics) = 158.5`',
    '`avg(data/scores.csv, score, subject=physics) = 79.3`',
    '`avg(data/scores.csv, score, subject=physics) = 79.25`',
    '`max(data/scores.csv, score) = 1,200`',
    '`distinct(data/scores.csv, subject) = 3`',
    '`count(data/scores.csv, score>80) = 2`',
    '`sum(data/*.csv, score, subject=physics) = 248.5`',
    '`files(notes/*.md) = 2`',
    '`lines(notes/*.md) = 3`',
  ].join('\n'));
  assert.deepEqual(r.map((x) => [x.expr, x.status]), r.map((x) => [x.expr, 'ok']));
});

test('wrong numbers and bad expressions', () => {
  const r = nums([
    '`sum(data/scores.csv, score) = 1358`',
    '`rows(data/scores.csv, grade=A) = 1`',
    '`count(missing.md, "x") = 1`',
  ].join('\n'));
  assert.deepEqual(r.map((x) => x.status), ['mismatch', 'error', 'error']);
});

test('precision follows what the agent wrote', () => {
  assert.equal(sameNumber('79.3', 79.25, 'avg'), true);
  assert.equal(sameNumber('79', 79.25, 'avg'), true);
  assert.equal(sameNumber('79', 79.25, 'sum'), false);
  assert.equal(sameNumber('3,120', 3120, 'sum'), true);
});

// --- fixes from the 0.1.1 code review ---

test('an empty file has 0 lines', () => {
  const r = check({ 'empty.txt': '', 'one.txt': '\n' }, '`lines(empty.txt) = 0` `lines(empty.txt) = 1` `lines(one.txt) = 1`').numbers.items;
  assert.deepEqual(r.map((x) => x.status), ['ok', 'mismatch', 'ok']);
});

test('whole numbers are compared exactly, decimals to the precision written', () => {
  assert.equal(sameNumber('1000000001', 1000000000, 'sum'), false);
  assert.equal(sameNumber('1000000000', 1000000000, 'sum'), true);
  assert.equal(sameNumber('0.1234567891', 0.1234567892, 'avg'), false);
  assert.equal(sameNumber('0.1234567892', 0.1234567892, 'avg'), true);
  // float noise from summing decimals is not a mismatch
  const tenth = Array.from({ length: 10 }, () => 0.1).reduce((s, x) => s + x, 0);
  assert.notEqual(tenth, 1);
  assert.equal(sameNumber('1', tenth, 'sum'), true);
  const csv = 'v\n' + Array.from({ length: 10 }, () => '0.1').join('\n') + '\n';
  assert.equal(check({ 't.csv': csv }, '`sum(t.csv, v) = 1`').numbers.items[0].status, 'ok');
});

test('numbers in scientific notation are read whole, not as a prefix', () => {
  const r = check({ 'one.md': 'a\n' }, '`lines(one.md) = 1e3`').numbers.items[0];
  assert.equal(r.claimed, '1e3');
  assert.equal(r.status, 'mismatch');
  assert.equal(sameNumber('1e3', 1000, 'sum'), true);
  assert.equal(sameNumber('1.5e-3', 0.0015, 'avg'), true);
  assert.equal(sameNumber('1.5e-3', 0.0016, 'avg'), false);
});

test('CSV: the delimiter is sniffed outside quotes', () => {
  const r = check({ 't.csv': '"a;b;c",value\nx,10\n' }, '`sum(t.csv, value) = 10`').numbers.items[0];
  assert.equal(r.status, 'ok');
});

test('CSV: "and" inside a quoted condition value is not a separator', () => {
  const files = { 't.csv': 'name,v\nResearch and Development,1\nSales,2\n' };
  const r = check(files, '`rows(t.csv, name="Research and Development") = 1` `rows(t.csv, v>0 and name=Sales) = 1`').numbers.items;
  assert.deepEqual(r.map((x) => x.status), ['ok', 'ok']);
});

test('CSV: a record of empty fields is kept, a blank line is not', () => {
  assert.deepEqual(parseCsv('a,b\n,\n\nx,y\n').rows, [['', ''], ['x', 'y']]);
  const r = check({ 't.csv': 'a,b\n,\nx,y\n' }, '`rows(t.csv) = 1` `rows(t.csv) = 2`').numbers.items;
  assert.deepEqual(r.map((x) => x.status), ['mismatch', 'ok']);
});

test('min() and max() over a long column', () => {
  const n = 500000;
  const csv = 'v\n' + Array.from({ length: n }, (_, i) => String(i + 1)).join('\n') + '\n';
  const r = check({ 'big.csv': csv }, `\`min(big.csv, v) = 1\` \`max(big.csv, v) = ${n}\``).numbers.items;
  assert.deepEqual(r.map((x) => x.status), ['ok', 'ok']);
});

test('a regex that backtracks forever fails the item instead of hanging the check', () => {
  const code = `
    import { check } from './test/helpers.js';
    const r = check({ 'log.txt': 'a'.repeat(40) + '!\\nTODO one\\n' },
      'count(log.txt, /(a+)+$/) = 0\\ncount(log.txt, /TODO/) = 1\\nlines_with(log.txt, /(a+)+$/) = 0',
      { regexTimeout: 1000 });
    console.log(JSON.stringify(r.numbers.items));
  `;
  const items = childItems(code);
  assert.deepEqual(items.map(x => x.status), ['error', 'ok', 'error']);
  assert.match(items[0].detail.reason, /did not finish within 1 s/);
});

test('integer precision and decimal ties use a single rounding result', () => {
  assert.equal(sameNumber('1000000000000', 1000000000000.5, 'sum'), false);
  for (const sign of [1, -1]) {
    for (const [x, y] of [[1.24999999, 1.2], [1.25, 1.3], [1.25000001, 1.3]]) {
      for (const claim of [1.2, 1.3]) assert.equal(sameNumber(String(sign * claim), sign * x, 'avg'), claim === y);
    }
  }
});

test('nonrepresentable exponents and incomplete claims cannot pass', () => {
  assert.equal(sameNumber('1e999', 1, 'sum'), false);
  assert.equal(sameNumber('1e-999', 0, 'sum'), false);
  const items = nums('lines(notes/a.md) = 1e+');
  assert.ok(!items.some(x => x.status === 'ok'));
});

function childItems(code) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL',
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test('empty and whitespace excerpts finish with minQuote zero', () => {
  const items = childItems(`
    import { check } from './test/helpers.js';
    const r = check({ 'n.md': 'alpha' }, 'n.md:1 ""\\nn.md:1 "  "', { minQuote: 0 });
    console.log(JSON.stringify(r.citations.items));
  `);
  assert.deepEqual(items.map(x => x.status), ['too_short', 'too_short']);
});

test('decimal midpoint rounds away from zero exactly once', () => {
  assert.equal(sameNumber('1.2', 1.25, 'avg'), false);
  assert.equal(sameNumber('-1.2', -1.25, 'avg'), false);
});
test('a truncated exponent is not a successful numeric claim', () => {
  assert.ok(!nums('lines(notes/a.md) = 1e+').some(i => i.pass));
});
