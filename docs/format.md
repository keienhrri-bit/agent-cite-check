# Report format

What `agent-cite-check` looks for in a report. Anything else in the report (prose, headings, other table columns) is ignored, so the format can sit inside whatever the agent normally writes.

A report can be Markdown or plain text, or JSON. Read from a file, or from stdin with `-`.

## 1. Sources

A source is a path, a line reference, and an excerpt that directly follows it.

| Written as | Meaning |
|---|---|
| `notes.md:42` | line 42 |
| `notes.md:L42`, `notes.md#L42` | line 42 |
| `notes.md:42-44`, `notes.md#L42-L44` | lines 42 to 44 |
| `notes.md 第42行`, `notes.md 第42-44行` | the same, in Chinese |
| `` `my notes.md`:42 `` | a path with spaces, in backticks |

The excerpt follows the line reference, optionally after `-`, `—` or `:`, in one of these quote pairs: `"…"`, `“…”`, `「…」`, `『…』`, `«…»`. It must close on the same line of the report. Straight double quotes may appear inside an excerpt; the excerpt ends at the `"` that is followed by the end of the line or a table-cell or list separator.

```
| 3 | Lab shipment | notes.md:16 "All twelve bottles were shipped to the lab on Friday." |
- 例会记录.md:6「待办：苏禾在周五前统计愿意认养的住户。」
- Several sources in one cell: notes.md:6 "Two samples were lost when the cooler lid cracked."; notes.md:9 "Rain started before noon, so station 4 was skipped."
```

Paths are resolved against `--root`, in this order: the path as written (absolute, or relative to the root) when it lies inside the root; then the file index, accepting a longer path (an absolute path from another machine, extra folders in front) or a shorter one (`notes.md` for `docs/notes.md`). If several files match, all are checked and the best result is kept; the JSON result lists the candidates.

Only files inside the root are read. A path that leads out of it (`..`, an absolute path elsewhere, a UNC or device path such as `\\server\share\x` or `\\?\C:\x`, a link or junction pointing outside) and has no match in the index fails as `missing_file` with `"reason": "outside_root"`; UNC paths are refused before any file access.

Files without an extension are recognized in three forms only, and only when the line number follows the colon directly and an excerpt follows: a fixed list of well-known names (`Dockerfile`, `Containerfile`, `Makefile`, `GNUmakefile`, `Justfile`, `Jenkinsfile`, `Vagrantfile`, `Procfile`, `Gemfile`, `Rakefile`, `Brewfile`, `LICENSE`, `LICENCE`, `COPYING`, `NOTICE`, `AUTHORS`, `CODEOWNERS`, `README`, `CHANGELOG`, `VERSION`), dotfiles (`.env`), and backticked paths that contain a folder separator (`` `bin/tool`:3 "…" ``). `` `status`: 200 "OK" `` is not a source.

### How an excerpt is compared

Before comparing, both the excerpt and the file are normalized: Unicode NFC; full-width ASCII (`ＳＮ－１２`) to half-width; ideographic spaces to spaces; curly quotes to straight quotes; then **all whitespace is removed**, including line breaks. So an excerpt that wraps across lines, or whose spacing differs, still matches. Nothing else is forgiven: a changed digit, a dropped clause or a paraphrase does not match.

Files are read as UTF-8 (with or without BOM), UTF-16 with BOM, or GB18030 when the bytes are not valid UTF-8. Binary files and files over 64 MB are reported as unreadable.

### Result of each source

| Status | Pass? | When |
|---|---|---|
| `ok` | yes | the excerpt is on the cited line(s) |
| `shifted` | yes | the excerpt is within `--tolerance` lines (default 3) of the cited line |
| `wrong_line` | no | the excerpt is in the file, further away than the tolerance |
| `out_of_range` | no | the cited line is past the end of the file |
| `altered` | no | no exact match, but a passage with bigram similarity ≥ 0.5 exists (near the cited line first, then anywhere in the file) |
| `not_found` | no | nothing similar in the file |
| `missing_file` | no | no file matches the path |
| `no_quote` | no | no excerpt follows the reference (`--allow-no-quote` lets it pass if the line exists) |
| `too_short` | no | the normalized excerpt is shorter than `--min-quote` characters (default 5) |
| `unreadable` | no | binary, too large, or unreadable |

## 2. Numbers

A number claim is an expression, `=` (or `==`), and the claimed value. Backticks around it are optional but recommended.

| Expression | Recomputes |
|---|---|
| `lines(file)` | number of lines (a glob adds up all matching files) |
| `count(file, "text")` | occurrences of the text (after the width and quote folding above; whitespace is kept) |
| `count(file, /regex/flags)` | regex matches (JavaScript syntax) |
| `lines_with(file, "text")` or `/regex/` | lines that contain it |
| `files(glob)` | files matching the glob (`*.md`, `docs/**/*.txt`) |
| `rows(file.csv, cond, …)` | CSV rows meeting every condition; `count(file.csv, cond)` is the same |
| `sum`, `avg`, `min`, `max` `(file.csv, column, cond, …)` | over the numeric cells of the column, in rows meeting the conditions |
| `distinct(file.csv, column, cond, …)` | number of different values in the column |

Conditions are `column op value` with `=`, `!=`, `>`, `<`, `>=`, `<=` or `~` (contains); combine them with commas or `and`. Column names match exactly, then case-insensitively, then after normalization. Quote names or values that contain commas: `rows(t.csv, "size, cm" > 3)`.

The CSV reader handles quoted cells, a BOM, and comma, tab or semicolon delimiters (sniffed from the header line). Numbers may be written `1,234`, `81.5` or `12%`.

The claimed value is compared at the precision the agent wrote it: `avg(...) = 51.3` passes if the true average rounds to 51.3; `sum(...) = 745` must be exact. An `avg` claimed as an integer is compared after rounding.

Result: `ok`, `mismatch` (shows the recomputed value), or `error` (unknown file or column, bad expression).

## 3. Files

Each line of the form `[+] path`, `[~] path` or `[-] path` (optionally after `- ` or `* `) declares a created, changed or deleted file. A path in backticks may contain spaces.

These are compared with what actually changed, from a snapshot (`--before`) or from `git status` (`--git`):

| Status | Pass? | When |
|---|---|---|
| `ok` | yes | changed, and reported |
| `kind_differs` | yes | reported, but as a different kind of change (for example `[~]` for a new file) |
| `unreported` | no | changed, but not in the report |
| `forbidden` | no | changed outside `--writable`, or inside `--protect` (whether reported or not) |
| `phantom` | no | reported, but unchanged or nonexistent |

The report file itself, the snapshot and the `--json` output are left out of the comparison.

A snapshot stores the size and SHA-256 of every file under the root (files over 512 MB: size only), skipping `.git/`, `node_modules/` and `--ignore` globs.

## 4. JSON reports

```json
{
  "citations": [
    { "file": "notes.md", "line": 42, "quote": "verbatim text" },
    { "file": "notes.md", "lines": "42-44", "excerpt": "text over three lines" },
    { "file": "notes.md", "start": 1200, "end": 1260, "text": "character range" }
  ],
  "numbers": [ { "expr": "count(notes.md, \"TODO:\")", "claim": 17 } ],
  "files": [ { "path": "out/table.md", "change": "+" }, "out/other.md" ],
  "findings": [ "free text, parsed like a Markdown report: notes.md:42 \"verbatim text\"" ]
}
```

- `citations`: `file` (or `path`, `source`), `line` or `lines`, optional `end_line`, `quote` (or `excerpt`, `text`), optional `id`. With `start` and `end`, the excerpt must lie within that character range of the file; the range must be whole numbers with `0 <= start < end <=` the file's length, else `out_of_range`. Line ranges must be in order and end inside the file.
- `numbers`: `expr` and `claim` (or `value`).
- `files`: strings, or objects with `path` (or `file`) and an optional `change`: `+`, `~`, `-`, `added`, `modified`, `deleted`, `created`, `new`, `changed`, `removed`.
- `findings`, `items`, `rows`: strings parsed like Markdown text.
- A top-level array of citation objects, number objects or strings also works.

A worker receipt with `files: [{ "path", "what" }]` and `findings: [ "..." ]` (the shape used by the brain-dispatch worker protocol) is read without changes.
