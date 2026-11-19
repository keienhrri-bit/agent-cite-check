# Changelog

## 0.1.2 (2026-11-19)

### Performance

- Windows and macOS: confirming where an opened file is no longer starts a process for each file (Windows PowerShell with `Add-Type`, or Perl). On the test machine (Windows 11, Node 24), checking a report with 32 citations of 32 files took 13.4–14.4 s with 0.1.1 and takes 0.20–0.22 s now, start-up included; a snapshot of 1,000 files went from 14.2 s to 0.9 s, with identical records. A locked-down PowerShell (Constrained Language Mode) or security software that blocks it no longer makes every citation unreadable.

### Security

- An opened file is checked in this process. Before the open, the object at the file's canonical path is recorded; after it, the canonical path must still lie inside the root and hold the object the descriptor holds (device and inode, the NTFS file ID on Windows, compared as 64-bit integers). Any failure counts as `outside_root`. On Linux the descriptor's own path is also read from procfs when it is mounted.
- Folder listings and link targets are read between two checks of the folder, the root included: a folder swapped for a link elsewhere during the read, and left so, is reported as a scan problem and its entries are dropped. Before, only a check before the read was made, and none for the root.

### Fixes

- Change check: files over 512 MiB are hashed like every other file (read in 1 MiB pieces). Before, they were recorded by size alone, so an edit that kept the length was missed. With a snapshot from 0.1.1 or earlier, a file recorded without a digest that still has the same size stops the check (exit code 2): take a new snapshot.
- A root reached through a link or another spelling (macOS `/var` is `/private/var`): a link inside it that points at the canonical absolute path, and an absolute path written in the canonical spelling, are inside the root. Before, they were refused as outside.
- A path that cannot be looked up (a folder without search permission, a link loop) fails its own item: a citation is `unreadable`, a number expression is an `error`, a Files entry is `phantom` with `unreadable: true`. Before, it stopped the whole check.
- Numbers: `sum()` and `avg()` add decimals exactly, so a correct `0` for `0.1 + 0.2 - 0.3` passes. Only a floating-point sum is forgiven float noise: `max()` of `1.0000000000000002` no longer matches `1`.
- Numbers: the claimed value is read whole. A malformed value (`1e2e3`, `1.2.3`, `1,2345`, `1e+`) is an `error` item; before, it disappeared from the report, was read as its first digits, or was a `mismatch`. A period or comma right after the value (`= 12.`) ends the sentence and is not part of it.
- Sources: any number of spaces may follow a closing straight quote before the line ends or a separator comes; the 2,000-character limit applies to the excerpt only. Before, an excerpt followed by more than 2,000 spaces was lost.
- Snapshot: a file whose check fails is named itself. Before, a failure in a batch of 32 files was reported for the first file of the batch.

### Known issues

- Windows and macOS: the checks after the open look the file up by path again. A process that swaps a folder on the way to a file for a link to a folder outside the root, and back, several times, each swap landing in the microseconds between two of the checks, could still get the outside file read. On Linux, procfs names the open descriptor itself, which rules this out. 0.1.1 asked Windows and macOS for the descriptor's path too, at the cost above.
- Folder listings and link targets are still read by path. Names from outside the root can enter the file index, or a link target can be recorded in a snapshot, only if a folder is swapped for a link and back while it is being read.

### Other

- Benchmark unchanged: 576 of 624 planted problems flagged, 0 of 630 benign variants.

## 0.1.1 (2026-11-19)

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

### Known issues

- Windows: before a cited file is read, a short PowerShell call confirms where the opened handle points. This adds about 0.35 s per cited file (32 citations took 12 s instead of 0.1 s on the test machine). A faster check is planned.
- Folder listings and link targets are still read by path. If another process swaps a folder for a link while a scan runs, names from outside the root can enter the file index, or a link target can be recorded in a snapshot. File contents are read only through verified handles.

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
