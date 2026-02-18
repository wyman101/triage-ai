# triage-ai

**AI-powered code review using Claude, Gemini and Codex — running in parallel.**

[Install](#installation) &bull; [Quick Start](#quick-start) &bull; [Editor Integration](#use-with-your-editor) &bull; [MCP Server](#mcp-server) &bull; [How It Works](#how-it-works)

![Node.js 18+](https://img.shields.io/badge/node-18+-green.svg) ![npm](https://img.shields.io/badge/npm-triage--ai-red.svg) ![MIT License](https://img.shields.io/badge/license-MIT-green.svg) ![Claude | Gemini | Codex](https://img.shields.io/badge/models-Claude%20%7C%20Gemini%20%7C%20Codex-purple.svg) ![MCP Compatible](https://img.shields.io/badge/MCP-compatible-orange.svg)

---

> **One AI reviewer has blind spots. Three AI reviewers have consensus.**

`triage-ai` runs Claude (Anthropic), Gemini (Google) and Codex (OpenAI) **in parallel** against your codebase. Each model independently analyzes your code, then triage merges their findings — deduplicating overlaps, surfacing consensus and flagging disagreements. The result is a single prioritized report where the issues that matter rise to the top.

```bash
npm install -g triage-ai && triage-ai "find security vulnerabilities"
```

That's it. No config files, no API keys to manage. It uses the AI CLIs you already have installed (`claude`, `gemini`, `codex` — you only need one).

## Why triage?

### The problem with single-model code review

Every AI model has different strengths and blind spots. Ask Claude, Gemini and Codex to review the same code and you'll get three different reports with some overlap and some unique finds. Manually comparing those reports is tedious and error-prone.

### What triage does differently

**triage-ai is the only tool that runs multiple AI models in parallel and merges their output into a single, deduplicated report with consensus scoring.**

| What | How |
|------|-----|
| **3 models, 1 report** | Claude, Gemini and Codex analyze your code simultaneously. You get one merged report, not three separate ones to compare. |
| **Consensus = confidence** | When 2 or 3 models independently flag the same issue, it's marked as consensus. These are your highest-confidence findings — the ones most likely to be real bugs, not hallucinations. |
| **Conflicts surface disagreements** | When models disagree on severity (e.g., Claude says S0 blocker, Codex says S2 medium), triage flags it so you can make the call. |
| **Parallel execution** | All models run at the same time. Three opinions in the time it takes to get one. |
| **Zero config** | Point it at your repo and describe what you want. triage auto-discovers relevant files, reads your git diff and redacts secrets before any model sees your code. |
| **Not a linter** | Linters enforce style rules. triage finds logic bugs, security vulnerabilities, race conditions, architectural issues — the things that are hard to write rules for. |
| **Auth detection** | If a CLI isn't logged in or has hit its rate limit, triage detects it and reports the issue with actionable instructions instead of silently failing. |

### What each model brings

- **Claude** (Anthropic) — Deep architectural reasoning, nuanced security analysis, strong understanding of complex control flow
- **Gemini** (Google) — Pattern recognition across large codebases, edge case detection, thorough documentation review
- **Codex** (OpenAI) — Practical code understanding, concrete fix suggestions, strong on common vulnerability patterns

You don't need all three. Use `--models claude` for a quick single-model check, or `--models claude,gemini` for faster consensus with two models. But when it matters — security audits, pre-release reviews, unfamiliar codebases — three models catch what one misses.

## Features

- **Parallel AI analysis** — Claude, Gemini and Codex run concurrently, not sequentially. Three reviews in the time of one.
- **Consensus detection** — Issues found by 2+ models are highlighted. High confidence, low false positive rate.
- **Conflict detection** — Surfaces disagreements between models so you can make informed decisions.
- **Smart context gathering** — Auto-discovers relevant files from your prompt, git diff, directory structure and keywords. No file lists to maintain.
- **Secret redaction** — API keys, passwords, private keys and credentials are stripped before any model sees your code. Your secrets never leave your machine.
- **Auth & rate-limit detection** — Detects when a CLI isn't authenticated or has hit API limits, and reports actionable error messages instead of failing silently.
- **Auto-patching** — Models propose unified diffs, safely applied on a new git branch. Preview with `--dry-run`.
- **MCP server** — First-class support for Claude Desktop, Claude Code, Cursor, Windsurf, Cline, VS Code, Zed and any MCP-compatible client.
- **Structured output** — Markdown reports for humans, JSON for CI/CD pipelines and automation.
- **Severity classification** — Findings ranked S0 (blocker) through S3 (style) for clear prioritization.
- **Cross-model memory** — Save findings to `CLAUDE.md`, `GEMINI.md` and `AGENTS.md` so every AI tool in your project remembers what triage found. Use `--remember` to write, `--forget` to clear.
- **Rich progress display** — Real-time phase-by-phase progress in terminal (intake → team → assessment → diagnosis → report). Plain text fallback for CI/CD.
- **Setup wizard** — `triage-ai setup` detects installed CLIs, shows paths and offers install instructions for missing ones.
- **Works with what you have** — Uses the AI CLIs already on your machine. No API keys to configure, no cloud service to sign up for.

## Installation

### One-liner (recommended)

```bash
npm install -g triage-ai
```

### First run

```bash
triage-ai setup
```

This detects which AI CLIs are installed and shows their paths. If any are missing, it provides install commands.

### Prerequisites

You need [Node.js](https://nodejs.org/) 18+ and at least one AI CLI installed and authenticated. triage works with any combination — use all three for consensus, or just one for quick checks.

| Model | CLI | Install |
|-------|-----|---------|
| **Claude** (Anthropic) | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` |
| **Gemini** (Google) | [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` |
| **Codex** (OpenAI) | [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` |

## Quick Start

### 1. Install

```bash
npm install -g triage-ai
```

### 2. Run

```bash
cd your-project
triage-ai "find bugs and security issues"
```

That's it. triage auto-discovers your files, runs Claude + Gemini + Codex in parallel and prints a merged report with consensus findings.

### 3. More Examples

```bash
# Use specific models (faster)
triage-ai --models claude,gemini "review for SQL injection"
triage-ai --models claude "quick single-model scan"

# Review only uncommitted changes (great before a commit)
triage-ai --diff-only "check my changes for bugs"

# Save report to file
triage-ai --out report.md "full security audit"

# Auto-fix with patches
triage-ai --dry-run "fix the XSS vulnerability"     # preview first
triage-ai --apply "fix the SQL injection"             # apply on new branch

# Save findings so Claude/Gemini/Codex remember them
triage-ai --remember "pre-launch security audit"
```

## Recommended Use: Validate AI Plans Before You Build

The highest-value way to use triage is **after an AI proposes a plan but before you implement it**.

AI coding tools like Claude Code, Cursor, Windsurf and Copilot often generate implementation plans — a set of proposed changes, a refactoring strategy, or an architecture for a new feature. These plans look reasonable, but a single model has blind spots. triage lets you get a second and third opinion before you invest time building.

This works for **any** AI's plan — including triage's own. If you use `triage-ai --apply` to generate patches, you can run triage again on the diff to validate its own output. Three models checking each other's work.

### Workflow

```
┌──────────────────────────────────────┐
│  1. AI proposes a plan               │
│     (Claude Code, Cursor, Copilot)   │
│                                      │
│  "Here's how I'd add auth..."        │
│  → saves to plan.md or PLAN.md       │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  2. triage reviews the plan          │
│                                      │
│  Three models independently check    │
│  for gaps, risks, and better         │
│  approaches                          │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  3. You implement with confidence    │
│                                      │
│  Consensus issues are real.          │
│  --remember saves them so your AI    │
│  tools avoid the same mistakes.      │
└──────────────────────────────────────┘
```

### How to do it

**Review a plan file:**

```bash
# AI wrote a plan to plan.md — review it before implementing
triage-ai "review the implementation plan in /path/to/plan.md — \
  check for security gaps, missing edge cases, scalability issues \
  and suggest improvements before I start building"
```

**Review a diff after AI-generated code:**

```bash
# AI already wrote the code — review the changes before committing
triage-ai --diff-only "an AI generated these changes. review for \
  correctness, security and edge cases before I commit"
```

**Review and remember — so the implementing AI knows the risks:**

```bash
# Review the plan AND save findings to AI memory
triage-ai --remember "review /path/to/plan.md for risks and improvements"

# Now when you tell Claude/Gemini/Codex to implement,
# they see the triage findings in their memory files
# and avoid the flagged issues
```

**Triage its own output — validate patches before applying:**

```bash
# Step 1: triage proposes patches (dry-run, don't apply yet)
triage-ai --dry-run --out patches.md "fix security issues in auth/"

# Step 2: review triage's own proposed patches with fresh context
triage-ai "review the proposed patches in /path/to/patches.md — \
  are these fixes correct? do they introduce new issues? \
  anything missed?"

# Step 3: confident the patches are good — apply them
triage-ai --apply "fix security issues in auth/"
```

## Example Output

Running `triage-ai "find security issues in the login system"` produces:

```
┌ triage-ai v2.0.0
│
├ Intake
│  ✓ Scanned repository          42 files, 3 modified
│  ✓ Redacted secrets             7 patterns masked
│  ✓ Built context package        186 KB across 28 files
│
├ Triage Team
│  ✓ Claude                       found at /usr/local/bin/claude
│  ✓ Gemini                       found at /usr/local/bin/gemini
│  ✗ Codex                        not installed (skipping)
│
├ Assessment
│  ✓ Claude                       16 findings (47.3s)
│  ✓ Gemini                       14 findings (38.2s)
│
├ Diagnosis
│  ✓ Clustered findings           22 unique issues from 2 models
│  ✓ Consensus detected           4 issues confirmed by 2+ models
│  ✓ Conflicts identified         1 severity disagreement
│
├ Report
│  ✓ Generated report             3 blockers, 5 high, 8 medium, 6 low
│  ✓ Saved to triage_results/     merged.json + per-model outputs
│
└ Done in 52.3s — 22 findings, 4 consensus
```

The merged report highlights consensus findings:

```markdown
# Code Triage Report

**Generated:** 2025-06-15 14:32:01
**Models:** claude, gemini

## Blockers (S0)

### 1. SQL Injection in User Lookup [CONSENSUS]

- **Severity:** S0
- **Confidence:** high
- **Category:** security
- **Location:** `auth/login.py:47-52`
- **Models:** claude, gemini

## Consensus Findings

- [S0] **SQL Injection in User Lookup** (auth/login.py) - *claude, gemini*
- [S1] **Weak Password Hashing** (auth/utils.py) - *gemini, codex*
- [S1] **Missing Rate Limiting** (auth/login.py) - *claude, gemini*
```

## Use with Your Editor

### MCP Server

triage-ai includes a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server, making it available as a tool in any MCP-compatible AI coding assistant.

Add to your editor's MCP configuration:

```json
{
  "mcpServers": {
    "triage": {
      "command": "triage-ai",
      "args": ["--mcp"]
    }
  }
}
```

#### Supported Editors & Clients

| Client | Config File | Docs |
|--------|-------------|------|
| **Claude Desktop** | `claude_desktop_config.json` | [MCP Quickstart](https://modelcontextprotocol.io/quickstart) |
| **Claude Code** | `.claude/settings.json` or `--mcp-config` | [Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code) |
| **Cursor** | `.cursor/mcp.json` | [Cursor MCP](https://docs.cursor.com/context/model-context-protocol) |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` | [Windsurf MCP](https://docs.windsurf.com/windsurf/mcp) |
| **Cline** | VS Code settings | [Cline MCP](https://github.com/cline/cline#mcp-support) |
| **VS Code** (GitHub Copilot) | `.vscode/mcp.json` | [VS Code MCP](https://code.visualstudio.com/docs/copilot/chat/mcp-servers) |
| **Zed** | `settings.json` | [Zed MCP](https://zed.dev/docs/assistant/model-context-protocol) |
| **Continue** | `config.json` | [Continue MCP](https://docs.continue.dev/customize/context-providers#mcp) |

See [`examples/mcp-config.json`](examples/mcp-config.json) for a ready-to-use config.

### Claude Code Slash Command

Copy [`examples/claude-code-skill.md`](examples/claude-code-skill.md) to `~/.claude/commands/triage.md`:

```bash
cp examples/claude-code-skill.md ~/.claude/commands/triage.md
```

Then in Claude Code:

```
/triage "find security issues in authentication"
/triage "check for race conditions in the worker pool"
```

### CI/CD Integration

Run in your pipeline to catch issues before merge:

```bash
# Exit code 1 if any S0 (blocker) findings
triage-ai --format json --out triage-report.json "security audit"

# Check for blockers
node -e "
const report = JSON.parse(require('fs').readFileSync('triage-report.json', 'utf8'));
if (report.summary.blockers > 0) {
  console.error('BLOCKED: ' + report.summary.blockers + ' blocker(s) found');
  process.exit(1);
}
console.log('No blockers found');
"
```

## How It Works

```
┌─────────────────┐
│   Your Prompt    │  "find security vulnerabilities"
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌────────────────────────────────────┐
│   Repo Scanner  │────▶│  Auto-discovers files, reads git    │
└────────┬────────┘     │  diff, redacts secrets, builds      │
         │              │  context package for each model      │
         │              └────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────┐
│        Parallel Execution                │
│                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │  Claude  │ │  Gemini  │ │  Codex   │ │
│  │(Anthropic│ │ (Google) │ │ (OpenAI) │ │
│  └─────┬────┘ └────┬─────┘ └─────┬────┘ │
│        │           │             │       │
└────────┼───────────┼─────────────┼───────┘
         │           │             │
         ▼           ▼             ▼
┌──────────────────────────────────────────┐
│         Merge & Deduplicate              │
│                                          │
│  • Cluster similar findings across models│
│  • Detect consensus (2+ models agree)    │
│  • Surface conflicts & disagreements     │
│  • Aggregate and deduplicate patches     │
└─────────────────┬────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────┐
│           Prioritized Report             │
│                                          │
│  • Findings ranked S0 → S3              │
│  • Consensus findings highlighted        │
│  • Proposed patches (unified diff)       │
│  • Recommended action plan               │
│  • Markdown or JSON output               │
└──────────────────────────────────────────┘
```

## Severity Levels

| Level | Name | Examples |
|-------|------|---------|
| **S0** | Blocker | SQL injection, RCE, auth bypass, data loss, crashes |
| **S1** | High | Logic bugs, race conditions, unhandled errors, XSS |
| **S2** | Medium | N+1 queries, missing validation, code duplication |
| **S3** | Low | Naming conventions, dead code, missing type hints |

## CLI Reference

```
triage-ai [PROMPT] [OPTIONS]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--models` | `claude,gemini,codex` | Which AI models to use (comma-separated) |
| `--diff-only` | off | Only analyze git diff, not full files |
| `--max-files` | 30 | Maximum files to include in context |
| `--format` | `md` | Output format: `md` (Markdown) or `json` |
| `--out` | stdout | Write report to file |
| `--apply` | off | Apply proposed patches (creates git branch first) |
| `--dry-run` | off | Preview patches without applying |
| `--timeout` | 300 | Per-model timeout in seconds |
| `--nice` | 10 | CPU priority for subprocesses |
| `--remember` | off | Save findings to AI memory files (CLAUDE.md, GEMINI.md, AGENTS.md) |
| `--forget` | — | Remove triage findings from memory files and exit |
| `--verbose` | off | Show detailed progress output |
| `--mcp` | — | Start as MCP server (for editor integration) |

### Subcommands

| Command | Description |
|---------|-------------|
| `triage-ai setup` | Detect installed CLIs, show paths, offer install instructions |

## Smart Context Discovery

You don't need to tell triage which files to look at. It figures it out:

| Source | How It Works |
|--------|-------------|
| **Explicit paths** | Paths mentioned in your prompt are read directly |
| **Git diff** | Changed files get priority |
| **Keyword search** | Words from your prompt are matched against filenames and file contents |
| **Entrypoints** | Standard files like `main.py`, `app.py`, `package.json` are included automatically |

Adjust scope with `--max-files`:

| Use Case | Recommended |
|----------|-------------|
| Single file or function review | `--max-files 5` |
| Feature or module audit | `--max-files 30` (default) |
| Full codebase security audit | `--max-files 100` |

## Safety & Privacy

### Secret Redaction

All file contents are scanned and secrets are replaced with `[REDACTED]` **before** any model receives them:

- API keys, auth tokens, bearer tokens
- Passwords and database connection strings
- Private keys (RSA, EC, DSA, OpenSSH)
- AWS access keys and secrets
- Generic high-entropy hex/base64 strings

### File Exclusions

Sensitive and binary files are automatically excluded:

- Secret files: `.env`, `credentials.json`, `.npmrc`, `.pypirc`, SSH keys
- Binary files: images, executables, archives, compiled files
- Junk directories: `node_modules`, `__pycache__`, `.git`, `venv`, `dist`

### Auth & Rate Limit Detection

triage detects when AI CLIs aren't properly authenticated or have hit rate limits:

- **Not logged in** — Clear message with login instructions for each CLI
- **API key issues** — Detects expired, invalid or missing API keys
- **Rate limits** — Reports when a model has hit its usage cap
- **Network errors** — Detects connection failures

Failed models are reported in the progress display but don't block other models from completing.

### Patch Safety

When using `--apply`:

- A **new git branch** is created before any changes
- Patches are **dry-run tested** before applying
- Maximum **5 files** modified per session
- **Non-git repos are refused** — no accidental writes to untracked projects

## AI Memory (`--remember`)

Most AI coding tools read a project-level markdown file for context:

| Tool | Memory File | What It Does |
|------|-------------|-------------|
| **Claude Code** | `CLAUDE.md` | Loaded into every Claude session in this project |
| **Gemini CLI** | `GEMINI.md` | Read by Gemini for project context |
| **Codex CLI** | `AGENTS.md` | Read by Codex/OpenAI agents for instructions |

When you run `triage-ai --remember`, findings are written into all three files using HTML comment markers (`<!-- triage:start -->` / `<!-- triage:end -->`). This means:

1. **Every AI tool knows about the issues** — Claude, Gemini and Codex all see the findings next time you use them
2. **Re-running replaces, not appends** — The triage section is swapped out on each run, keeping memory current
3. **Your existing content is preserved** — triage only touches the section between its markers
4. **Clean removal** — `triage-ai --forget` removes the triage section from all files, leaving everything else intact

## Configuration

Override which CLI commands triage calls:

```bash
export TRIAGE_CLAUDE_CMD="claude"       # default: claude
export TRIAGE_GEMINI_CMD="gemini"       # default: gemini
export TRIAGE_CODEX_CMD="codex"         # default: codex
export TRIAGE_GEMINI_MODEL="gemini-2.5-pro"  # override Gemini model
```

Config is stored at `~/.config/triage-ai/config.json` after first `triage-ai setup`.

## Use Cases

| Scenario | Command |
|----------|---------|
| **Pre-commit review** | `triage-ai --diff-only "review my changes for bugs"` |
| **Security audit** | `triage-ai "OWASP Top 10 vulnerability scan"` |
| **Performance review** | `triage-ai "find N+1 queries and memory leaks"` |
| **Code quality check** | `triage-ai "check for code smells and anti-patterns"` |
| **Bug investigation** | `triage-ai "why is the checkout flow failing for guest users?"` |
| **Dependency audit** | `triage-ai "check dependencies for known CVEs"` |
| **Pre-merge gate** | `triage-ai --format json --out report.json "security check"` |

## Development

```bash
git clone https://github.com/wyman101/triage-ai.git
cd triage-ai
npm install
npm run build
node dist/cli.js --help
```

### Project Structure

```
src/
├── cli.ts                # CLI entry point (commander.js)
├── scanner.ts            # Context gathering & secret redaction
├── setup.ts              # CLI detection & install wizard
├── merge.ts              # Finding deduplication & consensus
├── report.ts             # Markdown & JSON report generation
├── memory.ts             # AI memory file writer
├── patch.ts              # Safe patch application
├── progress.ts           # Rich terminal progress display
├── mcp-server.ts         # MCP server for editor integration
├── types.ts              # Shared interfaces & helpers
└── models/
    ├── base.ts           # Base model & subprocess management
    ├── claude.ts          # Claude (Anthropic) adapter
    ├── gemini.ts          # Gemini (Google) adapter
    └── codex.ts           # Codex (OpenAI) adapter
```

## Migrating from Python

If you previously installed the Python version:

```bash
# Remove Python version
pip uninstall triage

# Install npm version
npm install -g triage-ai
```

The CLI flags are identical. Your existing `--remember` memory blocks in CLAUDE.md/GEMINI.md/AGENTS.md are fully compatible.

## Contributing

Contributions welcome. Open an issue or PR at [github.com/wyman101/triage-ai](https://github.com/wyman101/triage-ai).

Ideas for contribution:
- Additional model adapters (Ollama, LM Studio, local models)
- GitHub Actions integration
- VS Code extension wrapper
- HTML report output
- Configurable severity thresholds

## License

MIT — use it however you want.
