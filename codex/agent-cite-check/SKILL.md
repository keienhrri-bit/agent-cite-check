---
name: agent-cite-check
description: Accept another agent's text work without calling a model. Before handing extraction, inventory or statistics work to a sub-run (codex exec, Gemini CLI, Claude Code, any CLI agent), write checkable acceptance conditions into the brief; when the report comes back, run agent-cite-check to verify every "file:line + excerpt" source, recompute every declared count or sum, and compare the files it changed with the files it reported. Use when the user says "check the report", "verify the sources", "acceptance check", "验收", "核对出处", "核对回报".
---

# agent-cite-check for Codex

The agent you dispatched says "notes.md line 42 says X, 17 in total, I created out/table.md". `agent-cite-check` verifies those three claims against the local files in about a second and prints a short summary. It never calls a model and never edits files.

## 1. Make the command available

Once per machine: clone https://github.com/keienhrri-bit/agent-cite-check (Node 20 or newer, no dependencies), then either

- `npm install -g <clone folder>` so that `agent-cite-check` is on PATH, or
- call `node <clone folder>/bin/agent-cite-check.js` directly and note that path in `AGENTS.md`.

Check with `agent-cite-check --version`. Below, `acc` is whichever form works.

## 2. Before you dispatch

1. Start from a brief in the repository's `templates/` (`templates/zh-CN/` in Chinese): `extract.md`, `inventory.md` or `stats.md`. Keep its "Rules" section word for word.
2. The brief must ask for:
   - a source at the end of every row: `path:line "verbatim excerpt"` (Chinese: `路径:行号「逐字摘录」`), at least 8 characters copied exactly;
   - every number as an expression in backticks, such as `count(notes.md, "TODO:") = 17` or `sum(costs.csv, amount) = 745`; if the items carry a marker, a `count()` of it, so you know how many rows to expect;
   - a "Files" section: `[+] path` created, `[~] path` changed, `[-] path` deleted;
   - one folder the agent may write to (for example `out/`).
3. Snapshot the working folder before the sub-run starts:

   ```
   acc snapshot --root <folder> -o <outside the folder>/before.json
   ```

   In a git repository with a clean working tree, `--git` at check time replaces the snapshot.

## 3. After the sub-run

Save the report to a file, then:

```
acc <report.md> --root <folder> --before <path>/before.json --writable "out/**"
```

- Exit 0: everything checks out. Exit 1: at least one item failed. Exit 2: bad arguments or unreadable input. Use the exit code as the gate in scripts.
- Read the summary, not the report. Each failing item is listed with its reason (`file does not exist`, `excerpt was changed; closest is line 42`, `claimed 13, recomputed 12`, `not in the report`, `changed a file outside the allowed area`).
- Failing rows are not usable as they are. Drop them, or send the failure list back to the same agent once. Do not start a second model to review the first.
- A file listed as `unreported` or `forbidden` means the agent changed something it did not tell you about. Look at it before you use anything else from that run.

## 4. Limits

- It checks only what the agent cited. Missing items show up only through a recomputed marker count that is larger than the number of rows.
- It checks wording, not meaning. A real excerpt can still be summarized wrongly.
- Default tolerance is 3 lines: a source that cites line 42 but quotes line 44 word for word passes as "shifted". `--tolerance 0` catches it, but then every line number that is off by one also fails as `wrong_line`; use it only when exact lines matter more than a few false alarms.

## 5. Options

`--tolerance N`, `--sample 20` or `--sample 25%` (with `--seed`), `--protect GLOB`, `--writable GLOB` (both repeatable), `--git`, `--json FILE`, `--format json`, `--lang zh|en`, `--max-failures N`, `--allow-no-quote`, `--allow-empty`. Run `acc --help` for the full list.

JSON reports also work: `{ "citations": [{ "file", "line", "quote" }], "numbers": [{ "expr", "claim" }], "files": [{ "path", "change" }] }`, or worker receipts with `findings` strings and `files[].path`.
