# Launch checklist

Where agent-cite-check can be listed without anyone signing in to a website, and what to submit. Nothing here has been submitted. List submissions go out from one place, one list at a time. Rules were read with `gh` on 2026-11-16; read them again before submitting, because lists change their rules.

## 1. The repository itself

- **Description**: `Check an AI agent's report against your local files without calling a model: quoted lines, declared numbers, changed files. Node CLI + Claude Code / Codex skills.`
- **Topics**: `claude-code`, `claude-code-plugin`, `claude-skills`, `agent-skills`, `codex`, `codex-cli`, `subagents`, `ai-agents`, `llm`, `hallucination`, `citations`, `verification`, `cli`, `nodejs`
- **README opening**: one sentence on what it does, the install command, then the benchmark detection and false-alarm rates. Keep the numbers in sync with `bench/RESULTS.md`.
- **Release v0.1.0**: notes are the CHANGELOG entry for 0.1.0 plus the benchmark table from the README.
- **Related projects**: once the sibling projects (usage audit, subagent cost) are public, add a "Related" line to both READMEs linking each other.

## 2. Lists that take submissions

### Eligible now

| List | Activity (2026-11-16) | How to submit | Requirements |
|---|---|---|---|
| [RoggeOhta/awesome-codex-cli](https://github.com/RoggeOhta/awesome-codex-cli) | 576 stars; new suggestions arrive daily. No PR has ever been merged: the maintainer adds entries in their own commits and closes the matching issue (latest such commit 2026-09-06, "Fixes #243") | issue, per [CONTRIBUTING.md](https://github.com/RoggeOhta/awesome-codex-cli/blob/main/CONTRIBUTING.md) ("Open an issue with the link and a brief description"); a PR is also allowed but none has been merged | directly related to Codex CLI; actively maintained; one-sentence description; star badge; "Self-promotion without substance" is refused. No age or star minimum is stated |

Submit as an issue. Title, in the form other suggestions use: `Resource suggestion: keienhrri-bit/agent-cite-check (Specialized Skills)`. Body: the link, the entry below, and one sentence on why it is Codex-specific (the Codex skill at `codex/agent-cite-check/SKILL.md` wraps `codex exec` sub-runs).

Section: **Skills > Specialized Skills**. Entry, in the list's own format:

```markdown
- [keienhrri-bit/agent-cite-check](https://github.com/keienhrri-bit/agent-cite-check) - Codex skill and Node CLI that checks a sub-run's report against local files: quoted lines, recomputed counts and sums, unreported file changes, no model calls. ![GitHub stars](https://img.shields.io/github/stars/keienhrri-bit/agent-cite-check?style=flat-square)
```

### Eligible later

| List | Why not now | When |
|---|---|---|
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) (37k stars, PRs merged daily) | [CONTRIBUTING.md](https://github.com/VoltAgent/awesome-agent-skills/blob/main/CONTRIBUTING.md): "Brand new skills that were just created are not accepted." | after the skill has outside users (installs on skills.sh, issues or stars from people other than the author) |

Entry for later (section **Community Skills > Development and Testing**, description at most 10 words, PR title `Add skill: keienhrri-bit/agent-cite-check`):

```markdown
- **[keienhrri-bit/agent-cite-check](https://github.com/keienhrri-bit/agent-cite-check/tree/main/skills/agent-cite-check)** - Checks agent reports' quoted lines, numbers and file changes
```

### Not suitable

| List | Reason, from its own rules or history |
|---|---|
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | [CONTRIBUTING.md](https://github.com/hesreallyhim/awesome-claude-code/blob/main/CONTRIBUTING.md): recommendations only through the web issue form, "not possible ... using the `gh` CLI", and "must be created by human beings"; resource at least 14 days old with commits after the first day, or 100 stars. Only the author can submit, by hand, signed in, from 2026-11-30 at the earliest. Suggested category if they do: Testing |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | [CONTRIBUTING.md](https://github.com/travisvn/awesome-claude-skills/blob/main/CONTRIBUTING.md): PRs under 10 stars are closed automatically; PRs must not be generated or submitted with AI assistance |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | submissions copy the skill folder into that repository; last merged PR 2026-05-22 |
| [jqueryscript/awesome-claude-code](https://github.com/jqueryscript/awesome-claude-code) | contribution guidelines say "Under Construction"; no merged PRs |
| [ccplugins/awesome-claude-code-plugins](https://github.com/ccplugins/awesome-claude-code-plugins) | no merged PRs; last push 2026-08-12 |
| [jamesmurdza/awesome-ai-devtools](https://github.com/jamesmurdza/awesome-ai-devtools) | last merged PR 2026-06-29 |

Do not open issues or discussions in other projects to announce this one.

## 3. Directories that find repositories on their own

Nothing to submit; the repository already has the files they look for.

| Directory | How it finds repositories | What this repository provides |
|---|---|---|
| [awesomeclaudeplugins.com](https://awesomeclaudeplugins.com) ([quemsah/awesome-claude-plugins](https://github.com/quemsah/awesome-claude-plugins)) | GitHub code search for `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` (`awesomeclaudeplugins.com/crawler/src/github/searchFamilies.ts` in that repository) | both files |
| [claude-plugins.dev](https://claude-plugins.dev) ([Kamalnrf/claude-plugins](https://github.com/Kamalnrf/claude-plugins)) | its README: the registry "automatically discovers and indexes all public Claude Code plugins and agent skills on GitHub"; the registry's own description names `.claude-plugin/marketplace.json` and `SKILL.md` under `skills/` | both |
| [skills.sh](https://skills.sh) | a leaderboard built from anonymous install telemetry of the `skills` CLI; a skill appears once people install it with `npx skills add keienhrri-bit/agent-cite-check`. The CLI finds `skills/<name>/SKILL.md` with `name` and `description` frontmatter ([discovery rules](https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md)) | `skills/agent-cite-check/SKILL.md`. The Codex copy under `codex/` is outside the CLI's search paths, so only one skill of that name is found |
| SkillsMP (skillsmp.com) | reported to scrape GitHub for `SKILL.md` and to skip repositories under 2 stars. Not verified: the site refused automated requests | `skills/agent-cite-check/SKILL.md` |

Not used: the npm registry (publishing needs an npm login). The README installs from GitHub with `npm install -g github:keienhrri-bit/agent-cite-check`.
