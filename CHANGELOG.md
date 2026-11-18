# Changelog

## 0.1.1 (2026-11-17)

### Security

- Citation and snapshot content is read through a verified open file descriptor. Canonical containment preserves case. UNC and device references are rejected before suffix or glob matching. For a refused path, citations return `missing_file` with reason `outside_root`, number expressions return `error` with an explanation in `detail.reason`, and unmatchable Files entries return `phantom` with `outside: true` and `exists: false`.
- A `/regex/` in a number expression runs with a 5-second limit. A pattern with catastrophic backtracking fails that item instead of hanging the check.

### Fixes

- Change check: a staged rename (`git mv`) is now a deletion of the old path plus an addition, so `--protect` and `--writable` see both. Before, only the new path was checked.
- Change check: symbolic links and junctions are recorded by target (never followed), so creating or redirecting one is a change. Before, they were invisible. When links are present, comparison requires a baseline that records them.
- Change check: a folder that cannot be read completely (unreadable subfolder, file that cannot be hashed, more than 200,000 files) stops `snapshot` and the check with exit code 2 instead of yielding a partial list.
- `--before` must be a snapshot file. `null`, `{}` or another tool's JSON used to switch the change check off or compare against an empty baseline; now exit code 2. Legacy snapshots remain usable on link-free trees. File sizes and SHA-256 records are validated.
- `--ignore` of a single file (`docs/x`) no longer drops the whole folder.
- Unknown options are errors (exit code 2): a misspelled `--writable` used to be ignored silently. `-o` in a check, extra arguments, and bad `--format`, `--lang` or `--sample` values are errors too.
- Sources: a cited range must be in order and end inside the file (`notes.md:1-999` on a one-line file is `out_of_range`); JSON character ranges must satisfy `0 <= start < end <= length` instead of being clamped.
- Sources: an excerpt that occurs more than 1,000 times is matched at the occurrence nearest the cited line; before, only the first 1,000 were considered.
- Sources: quoted excerpts support common extensionless names, dotfiles and arbitrary backticked paths, including names with spaces. CR, LF and CRLF delimit report lines. Empty normalized excerpts return `too_short` even with a zero minimum.
- Sources: a straight quote inside an excerpt followed by spaces no longer ends the excerpt early.
- Numbers: whole numbers are compared exactly (a claimed `1000000001` for an actual `1000000000` used to pass); decimals must round to the actual value at the precision written.
- Numbers: `1e3` is read whole instead of as `1`.
- Numbers: an empty file has 0 lines, not 1.
- CSV: the delimiter is sniffed outside quoted fields; `and` inside a quoted condition value is not a separator; a record of empty fields (`,`) is kept; `min()` and `max()` work on columns of any length.
- Index-based glob and suffix checks fail on incomplete scans. Ignored entries and empty directories do not count toward the file limit.
- A renamed target subsequently deleted from the working tree is not reported as an addition.
- Missing option values, fractional sample counts and shares above 100% are usage errors. The snapshot command accepts both `-o` and `--out`.
- Malformed and out-of-range exponents cannot pass. Decimal midpoint ties round away from zero.
- English extraction template: the snapshot is passed to the check with `--before`, not `-o`.

### Other

- PATH launchers `bin/agent-cite-check.cmd` and `bin/agent-cite-check`. The Claude Code plugin puts `bin/` on PATH; on Windows a bare `agent-cite-check` resolved to `agent-cite-check.js` and was opened by Windows Script Host instead of Node. Exit codes pass through both launchers.
- Skills: when the command is missing (a skill installed on its own with `npx skills add` has no `bin/`), offer `npm install -g github:keienhrri-bit/agent-cite-check` instead of a manual clone. README lists `npx skills add`.
- README: a "Related" section linking claude-code-usage-audit and claude-subagent-cost.

## 0.1.0 (2026-11-16)

First release.

- Source check: `path:line "excerpt"` (also `「」`, `“”`, `第N行`, `#L12-L14`, JSON objects and character ranges). Excerpts are compared after folding full-width characters, curly quotes and all whitespace; line numbers may be off by `--tolerance` lines (default 3). Results: `ok`, `shifted`, `wrong_line`, `out_of_range`, `altered`, `not_found`, `missing_file`, `no_quote`, `too_short`, `unreadable`.
- Number check: recomputes `lines`, `count`, `lines_with`, `files`, `rows`, `sum`, `avg`, `min`, `max` and `distinct` over text files and CSV, at the precision the agent wrote.
- File-change check: `snapshot` command and `--before`, or `--git`; `--writable` and `--protect`. Results: `ok`, `kind_differs`, `unreported`, `phantom`, `forbidden`.
- Summary in Chinese or English, full result as JSON, exit codes 0 / 1 / 2, `--max-failures`, `--sample`.
- Brief templates for extraction, inventory and statistics, in English and Chinese, each with an example report that the tests check.
- Skills for Claude Code (also installable as a plugin) and for Codex.
- Synthetic benchmark: 624 planted problems, 576 flagged; 630 benign variants, 0 flagged. See `bench/RESULTS.md`. `node bench/run.js --tolerance 0` shows the trade-off of a strict line tolerance.
