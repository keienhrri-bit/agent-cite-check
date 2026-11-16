# Inventory brief (template)

Use this when an agent has to take stock across several files: which tasks are done, which items are still open, what state each part of a project is in. One row per thing; a cell may need more than one source.

## For you (do not send this part)

1. Fill in the `<...>` parts. Keep the "Rules" section word for word.
2. List the things to take stock of yourself if you can (the five open tasks, the four rooms). If you cannot, ask for a `count()` that pins down how many there should be.
3. Snapshot the folder before you send the brief, then check the report:

   ```
   agent-cite-check snapshot --root <folder> -o before.json
   agent-cite-check <report.md> --root <folder> --before before.json --writable "out/**"
   ```

4. Read the summary only. A row whose sources fail is not usable as it is.

What a pass does not tell you: whether "no record" really means nothing was done (the agent may have missed a file), or whether the status is the right reading of the sources. The checker confirms each quoted line exists where the agent says; the status is still the agent's reading.

## Brief to send

```text
## Goal
For each <thing> below, say what state it is in, based only on the files listed.
- <thing 1>
- <thing 2>

## Read only these files
- <path/to/notes.md>
- <path/to/log.csv>

## Write
One file, <out/inventory.md>, with three parts.

1. A table with exactly these columns:

| # | Item | Status | Sources |
|---|---|---|---|

- Status: one of <done | open | no record>. "done" only if a line says it was done. "no record" if the files say nothing after the item was raised. Do not infer.
- Sources: every line the status rests on, each written as path:line "verbatim excerpt", separated by "; ".

2. A section "Numbers" with one expression per line in backticks, for example `count(<path/to/notes.md>, "<marker>") = N`.

3. A section "Files": `[+] path` for each file you created, `[~] path` for each file you changed.

## Rules
- Line numbers are the file's real line numbers, counting from 1. For a CSV, the header is line 1.
- The excerpt is copied character for character from that line: at least 8 characters, no paraphrase, no "..." in the middle, no added punctuation.
- Write paths exactly as they appear in this brief.
- If the files say nothing, write "no record". Do not guess.
- A script will check every source, number and file against the folder. Rows that do not check out will not be used.

## Boundaries
- Do not change, move or copy the files you read. Create only <out/inventory.md>.
- No advice and no explanations of why something is late.
```

## Example report

For the synthetic files in `examples/templates/workspace/` (goal: the state of each TODO in `minutes.md`). `npm test` runs the checker on it.

<!-- example-report citations=9 numbers=2 -->
```markdown
| # | Item | Status | Sources |
|---|---|---|---|
| 1 | Timber quotes (Theo) | done | minutes.md:6 "TODO: Theo gets two quotes for timber by Friday."; minutes.md:12 "Theo brought two quotes; the cheaper one was 410 dollars."; purchases.csv:2 "1,timber,beds,410" |
| 2 | Check the tap (Quinn) | done | minutes.md:7 "TODO: Quinn checks whether the tap near the shed still works."; minutes.md:15 "The tap works, but the hose is cracked." |
| 3 | Book the van (Mara) | no record | minutes.md:14 "TODO: Mara books the van for the delivery day." |
| 4 | Buy a hose (Quinn) | done | minutes.md:16 "TODO: Quinn buys a 20 m hose."; purchases.csv:5 "2,hose,water,24" |
| 5 | Watering rota (Ada) | no record | minutes.md:21 "TODO: Ada writes the watering rota and posts it on the shed door." |

## Numbers
- `count(minutes.md, "TODO:") = 5`
- `rows(purchases.csv, category=beds) = 3`

## Files
[+] out/inventory.md
```
