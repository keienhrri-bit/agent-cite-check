# agent-cite-check

[中文说明](README.zh-CN.md)

Checks an AI agent's report against your local files, without calling a model: are the quoted excerpts really on the cited lines, do the declared numbers recompute, and did the agent change only the files it reported?

```
npm install -g github:keienhrri-bit/agent-cite-check
agent-cite-check report.md --root <folder the report cites>
```

Synthetic benchmark ([bench/RESULTS.md](bench/RESULTS.md)): 576 of 624 planted problems flagged (92.3%), 0 of 630 benign variants flagged (0.0%). All 48 misses are one known blind spot, explained under [Measured results](#measured-results).

Your agent hands back a table that says "notes.md line 42 says X, 17 in total". This tool checks three things in about a second, against your local files:

1. **Sources**: is the quoted text really on line 42 of notes.md?
2. **Numbers**: does "17" come out again when the count is redone?
3. **File changes**: did the agent touch files it did not report, or files it was not allowed to touch?

It calls no model, needs no network and has no dependencies (Node 20 or newer). It prints a short summary and exits 0 or 1, so it works as an acceptance gate after any agent: Claude Code subagents, Codex, Gemini CLI, or a script of your own.

It checks wording and arithmetic, not meaning. It will not tell you whether the agent missed items or whether an excerpt supports the conclusion drawn from it.

## 30-second example

```
git clone https://github.com/keienhrri-bit/agent-cite-check
cd agent-cite-check
node bin/agent-cite-check.js examples/quickstart/report.md --root examples/quickstart/workspace
```

The [report](examples/quickstart/report.md) quotes five lines and states three numbers about a [small field-notes folder](examples/quickstart/workspace/). Output:

```
agent-cite-check: FAIL (4 problems)
Citations 5: 2 match, 3 do not
  #3 notes.md:16 "All twelve bottles were shipped to the lab on M… — excerpt was changed; closest is line 16 (similarity 0.91) "All twelve bottles were shipped to the l…"
  #4 notes.md:6 "Three samples were lost when the cooler lid crac… — excerpt was changed; closest is line 6 (similarity 0.88) "Two samples were lost when the cooler li…"
  #5 weather.md:3 "Wind from the west, 20 km/h." — file does not exist
Numbers 3: 2 recompute to the same value, 1 do not
  n2 sum(samples.csv, bottles) — claimed 13, recomputed 12
```

The file-change check needs a snapshot taken before the agent starts. [`examples/changes/demo.js`](examples/changes/demo.js) does the whole round trip in a temporary folder: snapshot, a pretend agent that writes `summary.md` and quietly edits `notes.md`, then the check.

```
node examples/changes/demo.js
```

```
$ agent-cite-check snapshot --root <tmp>/workspace -o <tmp>/before.json
snapshot: 2 files -> <tmp>/before.json

(agent works: creates summary.md, appends a line to notes.md, does not touch samples.csv)

$ agent-cite-check examples/changes/report.md --root <tmp>/workspace --before <tmp>/before.json --writable summary.md
agent-cite-check: FAIL (2 problems)
Citations 1: 1 match
File changes 3: 1 match the report, 2 do not
  ~ notes.md — changed a file outside the allowed area
  ? samples.csv — reported as changed, but unchanged
```

## Install

You need Node.js 20 or newer. There is nothing to build.

- **From GitHub onto PATH**: `npm install -g github:keienhrri-bit/agent-cite-check`, then `agent-cite-check ...`
- **Run from a clone**: `node <clone>/bin/agent-cite-check.js ...`, or `npm install -g <clone>` to put it on PATH
- **Claude Code plugin** (installs the skill below): `/plugin marketplace add keienhrri-bit/agent-cite-check`, then `/plugin install agent-cite-check@agent-cite-check`
- **Codex skill**: copy [`codex/agent-cite-check/`](codex/agent-cite-check/) to `~/.codex/skills/agent-cite-check/`
- **Skill only, with the [`skills`](https://github.com/vercel-labs/skills) CLI**: `npx skills add keienhrri-bit/agent-cite-check` copies the skill into your project for the agents you pick. It does not install the command; get that with the first line above.

The package is not published to the npm registry; the first command installs it straight from this repository.

## How to use it

```
agent-cite-check snapshot --root <folder> -o before.json          # before the agent starts
agent-cite-check <report.md> --root <folder> --before before.json  # after it reports back
```

`--root` is the folder the report's paths point into (default: the current folder). The report can be Markdown, plain text or JSON, or `-` for stdin. `agent-cite-check --help` lists every option.

### Sources

**What it does.** Finds every `path:line` reference followed by a quoted excerpt, opens the file and looks for the excerpt on that line.

**Format.** Any of these, in a table cell, a list or a sentence:

```
notes.md:42 "verbatim excerpt"
notes.md:42-44 “an excerpt over three lines”
docs/notes.md#L42 — "verbatim excerpt"
例会记录.md:6「待办：苏禾在周五前统计愿意认养的住户。」
例会记录.md 第15行「讨论后选了绿萝和吊兰两种，好养活。」
```

**How it compares.** Both sides are normalized first: full-width and half-width characters, curly and straight quotes, and all whitespace including line breaks are treated as equal, so wrapped or re-spaced excerpts still match. A changed digit, a dropped clause or a paraphrase does not match. Line numbers may be off by up to `--tolerance` lines (default 3); such sources pass as `shifted`.

**Result per source.** `ok` and `shifted` pass. `wrong_line` (the excerpt is elsewhere in the file), `out_of_range`, `altered` (no exact match, but a similar line exists; the summary shows it), `not_found`, `missing_file`, `no_quote` and `too_short` fail. Paths are resolved generously: `notes.md` finds `docs/notes.md`, and an absolute path from another machine finds the same file under `--root`.

**Limit.** A source that cites line 42 but quotes the exact text of line 44 passes as `shifted`. `--tolerance 0` closes this, at a cost: every line number that is off by even one line then fails as `wrong_line`. On the benchmark below, `node bench/run.js --tolerance 0` flags all 48 neighbor-line sources, and also all 72 benign sources whose line number is off by 1–3 (72 of the 504 benign sources).

### Numbers

**What it does.** Recomputes every declared number written as an expression:

```
`count(notes.md, "TODO:") = 17`
`lines_with(app.log, /ERROR|FATAL/) = 4`
`rows(purchases.csv, category=water) = 2`
`sum(purchases.csv, amount, category=beds) = 626.5`
`avg(scores.csv, score, group=B) = 81.5`
`files(docs/**/*.md) = 12`
```

Also `lines`, `min`, `max` and `distinct`. CSV conditions use `= != > < >= <= ~` (contains) joined by `and`. The value is compared at the precision the agent wrote: `81.5` is checked to one decimal.

**Limit.** It checks the expression as written, not whether it is the right question. Free-text numbers ("about seventeen") are not picked up.

### File changes

**What it does.** Compares what changed in the folder with the `[+] path` (created), `[~] path` (changed) and `[-] path` (deleted) lines in the report. Changes come from a snapshot (`--before`, size and SHA-256 per file) or from `git status` (`--git`).

**Results.** `unreported` (changed but not listed), `phantom` (listed but unchanged or nonexistent) and `forbidden` (outside `--writable` or inside `--protect`) fail. The report, the snapshot and the `--json` file are left out.

### Output and gate

- Exit code 0 when everything passes, 1 when anything fails, 2 for bad arguments or unreadable input. `--max-failures N` tolerates up to N failures.
- The summary is in Chinese when the report contains Chinese, else English (`--lang zh|en` to force).
- `--json result.json` writes every item with its status, the line where the excerpt was actually found, and the recomputed values. `--format json` prints it instead of the summary.
- `--sample 20` or `--sample 25%` checks a random sample of the sources in a long report (`--seed N` makes it repeatable).

The full format, including JSON reports, is in [docs/format.md](docs/format.md).

## Briefs and skills

The check is only as good as the report format. Three brief templates make agents write reports that can be checked:

| Template | For |
|---|---|
| [extract.md](templates/extract.md) | pulling items out of files (action items, decisions, log errors) |
| [inventory.md](templates/inventory.md) | the state of several things across files, several sources per row |
| [stats.md](templates/stats.md) | counts, sums and averages, each as a recomputable expression |

Chinese versions are in [templates/zh-CN/](templates/zh-CN/). Each template has a section for you (how to write the acceptance conditions, when to snapshot, what a pass does not prove), the brief to send, and an example report that `npm test` checks against [synthetic files](examples/templates/workspace/).

Two skills put the routine into the agent you work with:

- [skills/agent-cite-check/SKILL.md](skills/agent-cite-check/SKILL.md) for Claude Code: before dispatching to a subagent, write the acceptance conditions and take a snapshot; afterwards, run the check and read only the summary.
- [codex/agent-cite-check/SKILL.md](codex/agent-cite-check/SKILL.md) for Codex, the same routine around `codex exec` or any other CLI agent.

Both tell the agent what to do with each kind of failure: drop the row, use the line the checker found, or send the failure list back once. Not: start another model to review the first.

### With brain-dispatch

[brain-dispatch](https://github.com/keienhrri-bit/brain-dispatch) workers return a JSON receipt (`files[].path`, `findings[]`). agent-cite-check reads it as is, so it can run as the acceptance command after a dispatch:

```
agent-cite-check receipt.json --root <worker folder> --before before.json --writable "out/**"
```

Sources inside `findings` are checked like any other text. Findings without an excerpt fail as `no_quote` unless you pass `--allow-no-quote`.

## Measured results

### Synthetic benchmark

`node bench/generate.js` writes four made-up log files (two Chinese, two English, 160–220 lines each), a 60-row CSV, and 24 agent-style reports (12 in each language) with known problems planted in them. `node bench/run.js` runs the checker with default options and compares every result with the label the generator assigned when it planted the problem. The file-change part copies the folder 30 times and makes 5 random changes per copy. Full table: [bench/RESULTS.md](bench/RESULTS.md).

| | Planted problems | Flagged | Benign variants | Wrongly flagged |
|---|---:|---:|---:|---:|
| Sources | 432 | 384 | 504 | 0 |
| Numbers | 91 | 91 | 77 | 0 |
| File changes | 101 | 101 | 49 | 0 |
| **Total** | **624** | **576 (92.3%)** | **630** | **0 (0.0%)** |

- Planted source problems (48 of each kind): a file that does not exist, the line number moved 5–40 lines, a line number past the end of the file, no excerpt, one digit changed, one person's name swapped, a few characters or one word dropped from the middle, an invented sentence in the same style as the file, and the verbatim text of the next line. All 48 of the last kind passed as `shifted`: that is the 3-line tolerance at work, and it accounts for every miss. Without that kind, 576 of 576 planted problems were flagged.
- Benign variants that must pass: exact copies, re-spaced text, full-width vs half-width characters, curly vs straight quotes, excerpts that wrap across lines, lines that occur several times in the file, and line numbers off by 1–3.
- Planted number problems: off by a small amount, or an average rounded wrongly. Planted file problems: unreported creations, edits, same-size edits and deletions; reported files that were never written; edits to a protected path.

The data, the labels and the checker are written by the same author, so these numbers show that the checker does what it was designed to do. They do not show how often real agents make each kind of mistake.

### One real dispatch

Conditions: an external CLI agent (not Claude) extracted items from a synthetic meeting record and a small expense table, and reported them in the format described above: a source on every row, numbers as expressions, and a list of the files it created.

| | Result |
|---|---|
| Sources | 35 returned, 35 pass |
| Numbers (one marker count, two sums, one row count) | 4 returned, 4 recompute to the same value |
| File changes | 1 file created and reported; no other change |
| Time per check | 73–99 ms over 5 runs (Windows 11, Node 24) |

What this shows: the agent made no verbatim or arithmetic mistakes this time, and the checker raised no false alarm on a report written by someone else. It is not evidence of detection, because there was nothing to detect.

What the checker did not settle: whether every item was found, and whether each row was put in the right category. The recomputed marker count matched the number of action-item rows (25 of 25), which settles completeness for that one marker only. Classifying the other rows is a judgment the checker cannot make; it stays with a person.

To see detection on a real report, the author then planted one error at a time into the agent's report and reran the checker each time:

| Planted into the real report | Planted | Flagged |
|---|---:|---:|
| line number +10 | 35 | 35 |
| one character of the excerpt changed | 35 | 35 |
| middle third of the excerpt dropped | 35 | 35 |
| excerpt replaced by an invented sentence | 35 | 35 |
| file name changed | 35 | 35 |
| claimed number +1 | 4 | 4 |
| excerpt replaced by the verbatim text of a nearby line (1–3 lines) | 35 | 0 |

In all 214 runs, no source or number other than the planted one was flagged. The last row is the same blind spot as in the benchmark. Rerun with `--tolerance 0`, all 35 of that kind were flagged as `wrong_line`, and the unchanged report still passed in full.

The dispatch materials are not in this repository, so this section cannot be reproduced from it; the benchmark can.

## How it differs

| Project | What it does | Difference |
|---|---|---|
| [google/langextract](https://github.com/google/langextract) (39.3k stars) | Python library: a model extracts structured data and each extraction is mapped to character offsets in the source | It does the extraction with its own model calls. agent-cite-check checks a report someone else's agent already wrote, by file and line |
| Claude's Citations feature in the API | The model returns cited spans of documents supplied with the request | Citations are produced while generating. agent-cite-check is an independent check afterwards, for any agent |
| [tonydzi/verbatim-citation-gate](https://github.com/tonydzi/verbatim-citation-gate) (6 stars) | Zero-token verbatim gate plus a model judge for RAG answers | Aimed at RAG answers and retrieved chunks; no numbers, no file changes |
| [gianlucasb/hallucinator](https://github.com/gianlucasb/hallucinator) (401 stars) | Finds fabricated references in academic PDFs by looking them up in bibliographic databases | Checks references against external databases; agent-cite-check checks local files |
| [justin-rhee/anchor-check](https://github.com/justin-rhee/anchor-check) (0 stars) | Shell script: every `file:line` in an agent's plan must exist and be within the file's length | Closest in spirit. It does not compare excerpts, recompute numbers or check file changes |

Star counts as of 2026-11-16, read with `gh api`.

## Limits

- Only what the report cites is checked. Missing items show up only if you ask for a marker count and compare it with the number of rows.
- Wording, not meaning: a real excerpt can still be summarized wrongly.
- Excerpts of under 5 characters fail by default (`--min-quote`). A line that occurs several times in a file is accepted at the occurrence nearest the cited line, so a short, generic excerpt proves little; the templates ask for at least 8 characters.
- Numbers must be written as expressions. Prose numbers are ignored.
- File changes need a snapshot taken before the job, or a git repository.
- Text files only: PDF, Word and spreadsheets in binary formats are reported as unreadable. Convert them to text first and cite the converted file.

## Development

```
npm test                 # unit tests and template examples
node bench/generate.js   # regenerate the benchmark data (deterministic)
node bench/run.js        # rerun the benchmark, writes bench/RESULTS.md
```

CI runs the tests, the benchmark and both examples on Linux and Windows with Node 20, 22 and 24.

## Related

- [claude-code-usage-audit](https://github.com/keienhrri-bit/claude-code-usage-audit): measures where Claude Code and Codex usage goes, from the local logs.
- [claude-subagent-cost](https://github.com/keienhrri-bit/claude-subagent-cost): a Claude Code mod that shows each subagent's usage, warns when the quota is nearly used up, and writes a handoff before it runs out.

## License

MIT
