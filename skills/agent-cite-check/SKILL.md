---
name: agent-cite-check
description: Check a subagent's or another agent's report against the local files without calling a model - every "file:line + excerpt" source, every declared count or sum, every changed file. Use before dispatching text work (extraction, inventory, statistics) to Task subagents, Codex, Gemini or any CLI agent, and again when the report comes back. Triggers - "check the report", "verify the citations", "did it really say that", "acceptance check", "验收", "核对出处", "核对回报", "派单验收".
---

# agent-cite-check: accept an agent's report without another model

An agent hands back a table that says "notes.md line 42 says X, 17 in total". This skill checks three things in about a second: that line 42 really says that, that 17 recomputes, and that the agent touched no file it should not have. You read one short summary instead of the report.

It checks text, not meaning. It does not judge whether X supports a conclusion, whether the agent missed items, or whether a row is classified correctly.

## 1. Find the command (once per session)

Try in this order and use the first that works:

1. `agent-cite-check --version` (the Claude Code plugin puts the command on PATH, and so does an npm install)
2. `node <this skill's folder>/../../bin/agent-cite-check.js --version` (the skill came with a clone of the repository)
3. Neither works (for example, the skill was installed on its own with `npx skills add`): ask the user whether to install the command with `npm install -g github:keienhrri-bit/agent-cite-check` (Node 20 or newer, no dependencies, nothing to build), then use `agent-cite-check`.

Below, `acc` stands for whichever command worked.

## 2. Before you dispatch

1. Pick a brief template from the repository's `templates/` folder (`zh-CN/` for Chinese): `extract.md` (pull items out), `inventory.md` (state of several things across files), `stats.md` (counts and sums). Copy its "Rules" section into the brief word for word.
2. Write the acceptance conditions into the brief:
   - Every row ends with a source: `path:line "verbatim excerpt"` (Chinese: `路径:行号「逐字摘录」`). At least 8 characters, copied exactly.
   - Every number is an expression the checker can recompute, in backticks: `count(notes.md, "TODO:") = 17`, `sum(costs.csv, amount, category=beds) = 626.5`. If the items carry a fixed marker, ask for its `count()`: that pins down how many rows there should be.
   - A "Files" section listing every file the agent created or changed: `[+] path`, `[~] path`, `[-] path`.
   - Where the agent may write (for example `out/`).
3. Snapshot the folder the agent will work in, before it starts:

   ```
   acc snapshot --root <folder> -o <somewhere>/before.json
   ```

   In a git repository with a clean tree you can skip the snapshot and use `--git` later.

## 3. When the report comes back

Save the report to a file if the agent did not (a subagent's final message counts), then:

```
acc <report.md> --root <folder> --before <somewhere>/before.json --writable "out/**"
```

- Exit code 0: every source, number and file change checks out. Exit 1: something failed. Exit 2: wrong arguments or unreadable input.
- Read only the printed summary. It lists each failing item with the reason, for example `#7 notes.md:42 "..." - excerpt was changed; closest is line 42 (similarity 0.88)` or `n2 sum(costs.csv, amount) - claimed 13, recomputed 12`.
- Do not open the full report to "double-check" passing rows. That is the cost this skill removes.

What to do with failures:

| Status | Meaning | Action |
|---|---|---|
| `missing_file` | the cited file is not in the folder | drop the row |
| `out_of_range` | line number past the end of the file | drop the row, or use the line the summary names |
| `wrong_line` | excerpt is real but more than 3 lines from the cited line | use the line the summary names, if the row still makes sense there |
| `altered` | no exact match; a similar line exists | treat as not supported; the agent paraphrased or changed a detail |
| `not_found` | nothing like the excerpt in the file | drop the row: likely invented |
| `no_quote`, `too_short` | no excerpt, or under 5 characters | send back once, asking for excerpts |
| number `mismatch` | the claimed value does not recompute | use the recomputed value shown |
| `unreported` | a file changed that the report does not list | look at that file before trusting anything else |
| `forbidden` | a file outside `--writable` (or inside `--protect`) changed | stop and tell the user |
| `phantom` | the report lists a file that did not change or does not exist | the agent did not do what it says |

If more than a few rows fail, send the failure list back to the same agent once. Do not dispatch a second model to review the first one.

## 4. What a pass does not mean

- **Coverage**: the checker only sees what the agent cited. Compare the recomputed marker count with the number of rows yourself.
- **Meaning**: an excerpt can be real and still not support the summary next to it. Judgment calls stay with you; the agent's "open" list is where they usually are.
- **Neighbor lines**: with the default tolerance (3 lines) a row that cites line 42 but quotes the verbatim text of line 44 passes as "shifted". `--tolerance 0` catches it, but then every line number that is off by one also fails as `wrong_line`; use it only when exact line numbers matter more than a few false alarms.

## 5. Options worth knowing

- `--tolerance N`: how far the excerpt may sit from the cited line (default 3).
- `--sample 20` or `--sample 25%`: check a random sample of the sources in a long report (`--seed` fixes the sample).
- `--protect "docs/**"`: these paths must not change. `--writable` and `--protect` repeat.
- `--git`: compare against `git status` instead of a snapshot.
- `--json result.json`: the full result; `--format json` prints it instead of the summary.
- `--lang zh|en`: summary language (default follows the report).
- `--max-failures N`: pass with up to N failures.

JSON reports are read too: `{ "citations": [{ "file", "line", "quote" }], "numbers": [{ "expr", "claim" }], "files": [{ "path", "change" }] }`, and worker receipts whose `findings` are strings with sources inside and whose `files` list `{ "path" }`.
