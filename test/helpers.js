import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.js';
import { runChecks } from '../src/check.js';

/** Create a temp workspace from { relPath: content } and return its root. */
export function makeWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

export function check(files, report, opts = {}) {
  const root = typeof files === 'string' ? files : makeWorkspace(files);
  const ws = new Workspace(root);
  return runChecks(report, ws, opts);
}

export const statuses = (res) => res.citations.items.map((i) => i.status);
