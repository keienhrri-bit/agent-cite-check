# Statistics brief (template)

Use this when an agent has to count or add things up: how many lines match, how many rows meet a condition, a column total or average. Every number comes back as an expression the checker can recompute, so you never have to trust the arithmetic.

## For you (do not send this part)

1. Fill in the `<...>` parts. Keep the "Rules" and "Expressions" sections word for word.
2. Write the questions so that each answer is one expression. "Total spend on beds" is `sum(purchases.csv, amount, category=beds)`. A question the expressions cannot answer ("how many people agreed") needs a source line instead.
3. Check the report:

   ```
   agent-cite-check <report.md> --root <folder>
   ```

   Add `--before before.json --writable "out/**"` if you took a snapshot.
4. A failing number shows the claimed and the recomputed value side by side. Use the recomputed value.

What a pass does not tell you: whether the expression answers the question you meant. `rows(purchases.csv, category=water)` is checked as written; if water items were also filed under another category, the checker will not know.

## Brief to send

```text
## Goal
Answer these questions from the files below. Each answer is one number.
1. <question 1>
2. <question 2>

## Read only these files
- <path/to/table.csv>
- <path/to/notes.md>

## Write
One file, <out/stats.md>, with three parts.

1. A table with exactly these columns:

| # | Question | Value | Expression |
|---|---|---|---|

- Expression: the expression that gives the value, in backticks, ending in "= value" (see Expressions).
- If no expression fits, leave Expression as "none" and put a source in the Value cell instead: path:line "verbatim excerpt".

2. A section "Files": `[+] path` for each file you created.

## Expressions
- `lines(file) = N`                      lines in a text file
- `count(file, "text") = N`              times "text" occurs
- `count(file, /regex/) = N`             regex matches
- `lines_with(file, "text") = N`         lines containing "text"
- `files(glob) = N`                      files matching a glob such as *.md
- `rows(file.csv, column=value) = N`     CSV rows meeting the condition
- `sum(file.csv, column) = N`            column total; avg, min and max work the same way
- `sum(file.csv, column, other=value) = N`  total over rows meeting the condition
- `distinct(file.csv, column) = N`       number of different values in a column
Conditions: = != > < >= <= and ~ (contains); join several with "and".

## Rules
- Write numbers in full: 1234 or 1,234, decimals as you computed them. Do not round unless asked.
- Write paths exactly as they appear in this brief.
- A script will recompute every expression. Numbers that do not check out will not be used.

## Boundaries
- Do not change the files you read. Create only <out/stats.md>.
- No interpretation of the numbers.
```

## Example report

For the synthetic files in `examples/templates/workspace/`. `npm test` runs the checker on it.

<!-- example-report citations=1 numbers=9 -->
```markdown
| # | Question | Value | Expression |
|---|---|---|---|
| 1 | Total spend | 745 | `sum(purchases.csv, amount) = 745` |
| 2 | Spend on beds | 626.5 | `sum(purchases.csv, amount, category=beds) = 626.5` |
| 3 | Water purchases | 2 | `rows(purchases.csv, category=water) = 2` |
| 4 | Categories | 3 | `distinct(purchases.csv, category) = 3` |
| 5 | Average plant purchase | 41 | `avg(purchases.csv, amount, category=plants) = 41` |
| 6 | Largest purchase | 410 | `max(purchases.csv, amount) = 410` |
| 7 | Open tasks raised | 5 | `lines_with(minutes.md, "TODO:") = 5` |
| 8 | Decisions recorded | 3 | `count(minutes.md, /Decision:/) = 3` |
| 9 | Meeting notes files | 2 | `files(*.md) = 2` |
| 10 | Budget cap | minutes.md:8 "Ada said the budget cap is 1,200 dollars." | none |

## Files
[+] out/stats.md
```
