// The example report in every template must pass the checker against examples/templates/workspace,
// with exactly the number of citations and numbers the template promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '../src/workspace.js';
import { runChecks } from '../src/check.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WS = path.join(ROOT, 'examples', 'templates', 'workspace');
const MARK = /<!-- example-report citations=(\d+) numbers=(\d+) -->\s*```[a-z]*\r?\n([\s\S]*?)\r?\n```/;

const templates = ['templates', 'templates/zh-CN']
  .flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.md')).map((f) => path.join(d, f)));

test('every template has an example report', () => {
  assert.ok(templates.length >= 6, `found ${templates.length} templates`);
  for (const t of templates) assert.match(fs.readFileSync(path.join(ROOT, t), 'utf8'), MARK, t);
});

for (const t of templates) {
  test(`example report passes: ${t}`, () => {
    const m = MARK.exec(fs.readFileSync(path.join(ROOT, t), 'utf8'));
    const res = runChecks(m[3], new Workspace(WS), {}, t);
    const bad = [...res.citations.items, ...res.numbers.items].filter((i) => !i.pass);
    assert.deepEqual(bad, [], t);
    assert.equal(res.citations.total, Number(m[1]), `${t}: citations parsed`);
    assert.equal(res.numbers.total, Number(m[2]), `${t}: numbers parsed`);
  });
}
