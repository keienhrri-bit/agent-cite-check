# agent-cite-check

[English](README.md)

不调用模型，对着本地文件核对 AI Agent 交回的回报：摘录是不是真在所引的那一行，声明的数字重算对不对，Agent 改的文件是不是都报了。

```
npm install -g github:keienhrri-bit/agent-cite-check
agent-cite-check report.md --root <回报所引文件所在的目录>
```

合成测试集（[bench/RESULTS.md](bench/RESULTS.md)）：埋入的 624 处问题检出 576 处（92.3%），630 个无害变体误报 0 个（0.0%）。漏掉的 48 处都属于同一个已知盲区，见[实测](#实测)。

Agent 交回一张表，说“notes.md 第 42 行写着 X，一共 17 处”。这个工具对着你本地的文件，一秒左右核实三件事：

1. **出处**：notes.md 第 42 行是不是真这么写？
2. **数字**：17 这个数重算一遍还是不是 17？
3. **文件改动**：Agent 有没有改了回报里没说的文件，或者不该动的文件？

不调用任何模型，不联网，没有依赖（Node 20 及以上）。输出一段短摘要，退出码 0 或 1，可以直接当验收关卡，接在任何 Agent 后面：Claude Code 子代理、Codex、Gemini CLI，或者你自己的脚本。

它只核对字面和算术，不判断意思。它不会告诉你 Agent 有没有漏条，也不会告诉你摘录能不能支持旁边那句结论。

## 30 秒跑通

```
git clone https://github.com/keienhrri-bit/agent-cite-check
cd agent-cite-check
node bin/agent-cite-check.js examples/quickstart/report.md --root examples/quickstart/workspace
```

这份[回报](examples/quickstart/report.md)引了 5 行原文、报了 3 个数字，对象是一个[野外记录小文件夹](examples/quickstart/workspace/)。回报是英文的，所以摘要也是英文：

```
agent-cite-check: FAIL (4 problems)
Citations 5: 2 match, 3 do not
  #3 notes.md:16 "All twelve bottles were shipped to the lab on M… — excerpt was changed; closest is line 16 (similarity 0.91) "All twelve bottles were shipped to the l…"
  #4 notes.md:6 "Three samples were lost when the cooler lid crac… — excerpt was changed; closest is line 6 (similarity 0.88) "Two samples were lost when the cooler li…"
  #5 weather.md:3 "Wind from the west, 20 km/h." — file does not exist
Numbers 3: 2 recompute to the same value, 1 do not
  n2 sum(samples.csv, bottles) — claimed 13, recomputed 12
```

意思是：第 3、4 条摘录被改过（“Monday”原文是“Friday”，“Three”原文是“Two”），第 5 条引的文件不存在；瓶数合计报的是 13，重算是 12。

文件改动核对要在 Agent 开工前拍快照。[`examples/changes/demo.js`](examples/changes/demo.js) 在临时目录里走完一整轮：拍快照，一个假装的 Agent 写了 `summary.md`，又悄悄改了 `notes.md`，然后核对。

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

`notes.md` 不在允许改动的范围里却被改了；回报说改了 `samples.csv`，其实没动。

## 安装

需要 Node.js 20 及以上，不用编译。

- **从 GitHub 装到 PATH**：`npm install -g github:keienhrri-bit/agent-cite-check`，之后直接用 `agent-cite-check ...`
- **在克隆目录里直接跑**：`node <克隆目录>/bin/agent-cite-check.js ...`，或者 `npm install -g <克隆目录>` 装到 PATH
- **Claude Code 插件**（会装上下面的 skill）：`/plugin marketplace add keienhrri-bit/agent-cite-check`，再 `/plugin install agent-cite-check@agent-cite-check`
- **Codex skill**：把 [`codex/agent-cite-check/`](codex/agent-cite-check/) 复制到 `~/.codex/skills/agent-cite-check/`
- **只装 skill，用 [`skills`](https://github.com/vercel-labs/skills) 命令行**：`npx skills add keienhrri-bit/agent-cite-check` 把 skill 复制进你的项目，装给你选的 Agent。它不装命令本身，命令用上面第一条装。

没有发布到 npm 官方仓库；第一条命令直接从本仓库安装。

## 怎么用

```
agent-cite-check snapshot --root <目录> -o before.json          # Agent 开工前
agent-cite-check <回报.md> --root <目录> --before before.json    # 回报交回后
```

`--root` 是回报里路径所指的目录（默认当前目录）。回报可以是 Markdown、纯文本或 JSON，也可以用 `-` 从标准输入读。全部选项见 `agent-cite-check --help`。

### 出处核对

**做什么**：找出每个后面跟着引号摘录的 `路径:行号`，打开文件，看摘录在不在那一行。

**格式**：下面几种都认，放在表格、列表或句子里都行：

```
notes.md:42 "verbatim excerpt"
notes.md:42-44 “an excerpt over three lines”
docs/notes.md#L42 — "verbatim excerpt"
例会记录.md:6「待办：苏禾在周五前统计愿意认养的住户。」
例会记录.md 第15行「讨论后选了绿萝和吊兰两种，好养活。」
```

**怎么比**：两边先归一：全角半角、弯引号直引号、所有空白（包括换行）都视为相同，所以换了行或空格不一样的摘录照样对得上。改了一个数字、少了半句、换了说法，就对不上。行号允许偏差 `--tolerance` 行（默认 3），这种出处算通过，状态是 `shifted`。

**每条出处的结果**：`ok` 和 `shifted` 算通过。`wrong_line`（摘录在文件别处）、`out_of_range`（行号越界）、`altered`（没有原样出现，但有相似的行，摘要里会给出那一行）、`not_found`、`missing_file`、`no_quote`（没带摘录）、`too_short`（摘录太短）算不通过。路径解析比较宽松：写 `notes.md` 能找到 `docs/notes.md`，别的机器上的绝对路径也能对到 `--root` 下的同名文件。

**限制**：出处写第 42 行、摘录却原样抄的是第 44 行，会以 `shifted` 通过。`--tolerance 0` 能堵上这个口子，代价是行号只要差一行就按 `wrong_line` 算不通过。在下面的测试集上跑 `node bench/run.js --tolerance 0`：抄相邻行的 48 条全部检出，但 504 条无害出处里行号差 1–3 行的那 72 条也全部被报错。

### 数字核对

**做什么**：凡是写成式子的数字都重算一遍：

```
`count(notes.md, "TODO:") = 17`
`lines_with(app.log, /ERROR|FATAL/) = 4`
`rows(采购.csv, 分项=器具) = 3`
`sum(采购.csv, 金额, 分项=植物) = 330`
`avg(scores.csv, score, group=B) = 81.5`
`files(docs/**/*.md) = 12`
```

另有 `lines`、`min`、`max`、`distinct`。CSV 条件可用 `= != > < >= <= ~`（包含），多个条件用 `and` 连接。比较精度跟着 Agent 的写法走：写 `81.5` 就核到一位小数。

**限制**：只按写出来的式子核对，不管这个式子是不是你想问的问题。散文里的数字（“大约十七处”）不会被识别。

### 文件改动核对

**做什么**：把目录里实际发生的改动，和回报里的 `[+] 路径`（新建）、`[~] 路径`（改动）、`[-] 路径`（删除）逐一对照。实际改动来自快照（`--before`，记录每个文件的大小和 SHA-256）或 `git status`（`--git`）。

**结果**：`unreported`（改了但没报）、`phantom`（报了但没变或不存在）、`forbidden`（改了 `--writable` 以外或 `--protect` 以内的文件）算不通过。回报文件本身、快照文件、`--json` 输出文件不计入。

### 输出和关卡

- 全部通过退出码 0，有不通过的为 1，参数错误或读不了输入为 2。`--max-failures N` 允许最多 N 项不通过。
- 回报里有中文时摘要用中文，否则用英文（`--lang zh|en` 可强制）。
- `--json result.json` 写出每一项的状态、摘录实际所在的行、重算出的数值；`--format json` 把它直接打印出来，代替摘要。
- `--sample 20` 或 `--sample 25%` 对长回报只抽查一部分出处（`--seed N` 让抽样可复现）。

完整格式（包括 JSON 回报）见 [docs/format.md](docs/format.md)（英文）。

## 任务书模板和 skill

核对效果取决于回报格式。三份任务书模板让 Agent 交回能核对的回报：

| 模板 | 用途 |
|---|---|
| [抽取](templates/zh-CN/extract.md) | 从文件里捞条目（待办、决定、日志报错） |
| [盘点](templates/zh-CN/inventory.md) | 跨文件盘点几样东西的状态，一行可以有多处出处 |
| [统计](templates/zh-CN/stats.md) | 计数、求和、平均，每个数都写成能重算的式子 |

英文版在 [templates/](templates/)。每份模板分三部分：给你看的（怎么写验收条件、什么时候拍快照、通过不代表什么）、发给 Agent 的任务书、一份示例回报。示例回报由 `npm test` 对着[合成文件](examples/templates/workspace/)跑核对器。

两个 skill 把这套流程交给你用的 Agent：

- [skills/agent-cite-check/SKILL.md](skills/agent-cite-check/SKILL.md)：Claude Code 用。派给子代理之前写好验收条件、拍快照；交回后跑核对，只读摘要。
- [codex/agent-cite-check/SKILL.md](codex/agent-cite-check/SKILL.md)：Codex 用，流程相同，套在 `codex exec` 或其他 CLI Agent 外面。

两个 skill 都写明了每种不符怎么处理：删掉这一行、改用核对器找到的行，或者把不符清单退回去改一次。不要再派一个模型去审第一个模型。

### 配合 brain-dispatch

[brain-dispatch](https://github.com/keienhrri-bit/brain-dispatch) 的 worker 交回 JSON 回执（`files[].path`、`findings[]`）。agent-cite-check 原样读取，可以当派单后的验收命令：

```
agent-cite-check receipt.json --root <worker 目录> --before before.json --writable "out/**"
```

`findings` 里的出处和普通文本一样核对。没带摘录的出处按 `no_quote` 算不通过，加 `--allow-no-quote` 则只要文件和行存在就算通过。

## 实测

### 合成测试集

`node bench/generate.js` 生成 4 份编造的日志（中英文各 2 份，每份 160–220 行）、一份 60 行的 CSV，以及 24 份 Agent 风格的回报（中英文各 12 份），回报里埋了已知的问题。`node bench/run.js` 用默认参数跑核对器，把每一项结果和生成器埋错时给的标签对比。文件改动部分把目录复制 30 次，每次随机做 5 处改动。完整表格见 [bench/RESULTS.md](bench/RESULTS.md)。

| | 埋入的问题 | 检出 | 无害变体 | 误报 |
|---|---:|---:|---:|---:|
| 出处 | 432 | 384 | 504 | 0 |
| 数字 | 91 | 91 | 77 | 0 |
| 文件改动 | 101 | 101 | 49 | 0 |
| **合计** | **624** | **576（92.3%）** | **630** | **0（0.0%）** |

- 埋入的出处问题（每类 48 条）：文件不存在；行号挪了 5–40 行；行号超出文件末尾；没带摘录；改了一个数字；换了一个人名；从中间删掉几个字或一个词；按文件风格编造的一句话；原样抄下一行的文字。最后一类 48 条全部以 `shifted` 通过，这是 3 行容差造成的，也是全部漏检的来源。去掉这一类，576 条埋入问题全部检出。
- 必须通过的无害变体：原样摘录；空格不同；全角半角不同；弯引号直引号不同；跨行的摘录；文件里重复出现的行；行号偏差 1–3 行。
- 埋入的数字问题：差一点点的值，平均数四舍五入错。埋入的文件问题：没报的新建、修改、等长修改、删除；报了却没写的文件；改了受保护的路径。

测试数据、标签和核对器出自同一个作者，所以这组数字只说明核对器做到了设计要做的事，不说明真实 Agent 各类错误出现得有多频繁。

### 一次真实派单

条件：一个外部 CLI Agent（不是 Claude）从一份合成的会议记录和一张小支出表里抽取条目，按上文的格式交回：每行带出处，数字写成式子，列出新建的文件。

| | 结果 |
|---|---|
| 出处 | 交回 35 条，35 条通过 |
| 数字（1 个标记计数、2 个求和、1 个行数） | 交回 4 个，4 个重算一致 |
| 文件改动 | 新建 1 个文件且已报告，没有其他改动 |
| 每次核对用时 | 5 次运行 73–99 毫秒（Windows 11，Node 24） |

说明了什么：这次 Agent 没有出现摘录或算术错误，核对器对别人写的回报也没有误报。这不能证明检出能力，因为这次没有可检出的错。

核对器没有解决的：条目有没有找全，每行归类对不对。重算的待办标记数和表里的待办行数一致（25 对 25），但这只能说明这一种标记没有漏。其余各行归类对不对是判断题，核对器判断不了，要留给人看。

为了在真实回报上看检出，作者随后在这份回报里每次只埋一处错，各跑一遍核对器：

| 在真实回报里埋的错 | 埋入 | 检出 |
|---|---:|---:|
| 行号 +10 | 35 | 35 |
| 摘录改一个字 | 35 | 35 |
| 删掉摘录中间三分之一 | 35 | 35 |
| 摘录换成编造的句子 | 35 | 35 |
| 文件名改错 | 35 | 35 |
| 声明的数字 +1 | 4 | 4 |
| 摘录换成附近 1–3 行的原文 | 35 | 0 |

214 次运行里，除了埋错的那一项，其他出处和数字一次都没有被报错。最后一行就是测试集里那个已知盲区。改用 `--tolerance 0` 重跑，这一类 35 次全部以 `wrong_line` 检出，没埋错的原回报仍然全部通过。

这次派单的材料不在仓库里，所以这一节没法用仓库复现；测试集可以。

## 和类似项目的区别

| 项目 | 做什么 | 区别 |
|---|---|---|
| [google/langextract](https://github.com/google/langextract)（3.93 万 star） | Python 库：由模型抽取结构化信息，每条抽取对应到原文的字符位置 | 它自己调模型做抽取；agent-cite-check 核对的是别的 Agent 已经交回的回报，按文件和行号 |
| Claude API 的 Citations 功能 | 模型在回答时给出所附文档里被引用的片段 | 引用在生成时产生；agent-cite-check 是事后的独立核对，适用于任何 Agent |
| [tonydzi/verbatim-citation-gate](https://github.com/tonydzi/verbatim-citation-gate)（6 star） | RAG 回答的零 token 逐字门禁，加一个模型裁判 | 面向 RAG 回答和检索片段；不核数字，不核文件改动 |
| [gianlucasb/hallucinator](https://github.com/gianlucasb/hallucinator)（401 star） | 在学术 PDF 里查编造的参考文献，去文献数据库比对 | 查的是外部数据库；agent-cite-check 查本地文件 |
| [justin-rhee/anchor-check](https://github.com/justin-rhee/anchor-check)（0 star） | Shell 脚本：Agent 计划里的每个 `文件:行号` 都要存在、行号不超出文件长度 | 思路最接近。它不比对摘录，不重算数字，不核文件改动 |

star 数为 2026-11-16 用 `gh api` 读到的值。

## 限制

- 只核对回报里引了的东西。漏掉的条目，只有在你要求了标记计数、并拿它和行数比较时才能发现。
- 只核字面，不核意思：摘录是真的，旁边的摘要照样可能写错。
- 摘录不到 5 个字默认算不通过（`--min-quote`）。同一行在文件里出现多次时，按离所引行号最近的那处算，所以太短太普通的摘录说明不了什么；模板要求至少 8 个字。
- 数字必须写成式子，散文里的数字不识别。
- 文件改动核对需要开工前的快照，或者一个 git 仓库。
- 只读文本文件：PDF、Word、二进制表格会被报为读不了。先转成文本，再引用转换后的文件。

## 开发

```
npm test                 # 单元测试和模板示例
node bench/generate.js   # 重新生成测试集（结果固定）
node bench/run.js        # 重跑测试集，写出 bench/RESULTS.md
```

CI 在 Linux 和 Windows 上、用 Node 20、22、24 跑测试、测试集和两个示例。

## 相关工具

- [claude-code-usage-audit](https://github.com/keienhrri-bit/claude-code-usage-audit)：读本地日志，量出 Claude Code 和 Codex 的用量花在哪。
- [claude-subagent-cost](https://github.com/keienhrri-bit/claude-subagent-cost)：Claude Code mod，显示每个子代理的用量，额度快满时提醒，并在用完前写好交接。

## 许可证

MIT
