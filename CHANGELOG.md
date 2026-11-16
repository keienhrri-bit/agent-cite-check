# Changelog

## Unreleased

- PATH launchers `bin/agent-cite-check.cmd` and `bin/agent-cite-check`. The Claude Code plugin puts `bin/` on PATH; on Windows a bare `agent-cite-check` resolved to `agent-cite-check.js` and was opened by Windows Script Host instead of Node. Exit codes pass through both launchers.
- Skills: when the command is missing (a skill installed on its own with `npx skills add` has no `bin/`), offer `npm install -g github:keienhrri-bit/agent-cite-check` instead of a manual clone.

## 0.1.0 (2026-11-16)

First release.

- Source check: `path:line "excerpt"` (also `「」`, `“”`, `第N行`, `#L12-L14`, JSON objects and character ranges). Excerpts are compared after folding full-width characters, curly quotes and all whitespace; line numbers may be off by `--tolerance` lines (default 3). Results: `ok`, `shifted`, `wrong_line`, `out_of_range`, `altered`, `not_found`, `missing_file`, `no_quote`, `too_short`, `unreadable`.
- Number check: recomputes `lines`, `count`, `lines_with`, `files`, `rows`, `sum`, `avg`, `min`, `max` and `distinct` over text files and CSV, at the precision the agent wrote.
- File-change check: `snapshot` command and `--before`, or `--git`; `--writable` and `--protect`. Results: `ok`, `kind_differs`, `unreported`, `phantom`, `forbidden`.
- Summary in Chinese or English, full result as JSON, exit codes 0 / 1 / 2, `--max-failures`, `--sample`.
- Brief templates for extraction, inventory and statistics, in English and Chinese, each with an example report that the tests check.
- Skills for Claude Code (also installable as a plugin) and for Codex.
- Synthetic benchmark: 624 planted problems, 576 flagged; 630 benign variants, 0 flagged. See `bench/RESULTS.md`. `node bench/run.js --tolerance 0` shows the trade-off of a strict line tolerance.
