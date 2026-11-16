import { test } from 'node:test';
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
