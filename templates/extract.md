# Extraction brief (template)

Use this when an agent has to pull items out of files: action items, decisions, quotes, errors in a log, rows that match a rule. The agent returns a table; every row carries a source the checker can open.

## For you (do not send this part)

1. Fill in the `<...>` parts of the brief below. Keep the "Rules" section word for word: the checker depends on it.
2. If the items have a fixed marker (`TODO:`, `ERROR`, `待办：`), ask for a `count()` of that marker. The checker recomputes it, so you know the true total; compare it with the number of rows the agent returned.
3. Before you send the brief, take a snapshot of the folder the agent will work in:

   ```
   agent-cite-check snapshot --root <folder> -o before.json
   ```

   Keep `before.json` outside that folder. If it is inside, pass that same path to the check with `--before`: the checker leaves it out of the change list.
4. When the report comes back:

   ```
   agent-cite-check <report.md> --root <folder> --before before.json --writable "out/**"
   ```

   Exit code 0 means every source, number and file change checks out. Read the summary only. Rows listed as failing are not usable as they are: drop them, or send the list back once.

What a pass does not tell you: whether the agent missed items (use the marker count), whether a row is the right type, or whether the summary column is fair. Those are judgment calls the checker does not make.

## Brief to send

```text
## Goal
Find every <kind of item> in the files below and return one table row per item.

## Read only these files
- <path/to/file.md>
- <path/to/other-file.md>

## Write
One file, <out/extract.md>, with three parts.

1. A table with exactly these columns:

| # | Type | Owner | Summary | Source |
|---|---|---|---|---|

- Type: <type A> or <type B>. <How to tell them apart.>
- Owner: the person named in the line; "none" if no one is named.
- Summary: your own words, at most 15 words.
- Source: path:line "verbatim excerpt" (see Rules).
- One row per item, in file order, each item once.

2. A section "Numbers": one line per claim, written as an expression in backticks:
- `count(<path/to/file.md>, "<marker>") = N`

3. A section "Files": one line per file you created or changed, written as `[+] path` (created), `[~] path` (changed) or `[-] path` (deleted).

## Rules
- Line numbers are the file's real line numbers, counting from 1.
- The excerpt is copied character for character from that line: at least 8 characters, no paraphrase, no "..." in the middle, no added punctuation. An excerpt that runs over two lines is cited as path:12-13.
- Write paths exactly as they appear in this brief.
- If nothing in the files supports a cell, write "none". Do not guess.
- A script will check every source, number and file against the folder. Rows that do not check out will not be used.

## Boundaries
- Do not change, move or copy the files you read. Create only <out/extract.md>.
- No conclusions, no advice. If you are unsure whether something counts, list it under "Open" at the end instead of the table.
```

## Example report

This is what a good report looks like for the synthetic files in `examples/templates/workspace/` (goal: every TODO and every decision in `minutes.md`). `npm test` runs the checker on it.

<!-- example-report citations=11 numbers=2 -->
```markdown
| # | Type | Owner | Summary | Source |
|---|---|---|---|---|
| 1 | decision | none | Raised beds, not in-ground planting | minutes.md:5 "The group agreed to use raised beds instead of planting in the ground." |
| 2 | todo | Theo | Two timber quotes by Friday | minutes.md:6 "TODO: Theo gets two quotes for timber by Friday." |
| 3 | todo | Quinn | Check the tap by the shed | minutes.md:7 "TODO: Quinn checks whether the tap near the shed still works." |
| 4 | decision | none | Compost bins behind the shed | minutes.md:9 "Decision: compost bins go behind the shed, not near the gate." |
| 5 | decision | none | Cheaper timber quote chosen | minutes.md:13 "The group chose the cheaper timber quote." |
| 6 | todo | Mara | Book the van | minutes.md:14 "TODO: Mara books the van for the delivery day." |
| 7 | todo | Quinn | Buy a 20 m hose | minutes.md:16 "TODO: Quinn buys a 20 m hose." |
| 8 | decision | none | Watering rota starts after filling | minutes.md:17 "Decision: the watering rota starts once the beds are filled." |
| 9 | todo | Ada | Write and post the watering rota | minutes.md:21 "TODO: Ada writes the watering rota and posts it on the shed door." |
| 10 | decision | Ada | No fence this year | minutes.md:22 "Someone asked about a fence; Ada said "not this year"." |
| 11 | decision | none | Opening day set | minutes.md:23 "Decision: the opening day is the first Sunday of next month." |

## Numbers
- `count(minutes.md, "TODO:") = 5`
- `count(minutes.md, "Decision:") = 3`

## Files
[+] out/extract.md

## Open
- Row 10: Ada answered a question; unclear whether that counts as a group decision.
```
