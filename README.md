<p align="center">
  <h1 align="center">triage</h1>
  <p align="center">
    <strong>AI-powered code review using Claude, Gemini, and Codex — running in parallel.</strong>
  </p>
  <p align="center">
    <a href="#installation">Install</a> &bull;
    <a href="#quick-start">Quick Start</a> &bull;
    <a href="#use-with-your-editor">Editor Integration</a> &bull;
    <a href="#mcp-server">MCP Server</a> &bull;
    <a href="#how-it-works">How It Works</a>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/python-3.9+-blue.svg" alt="Python 3.9+">
    <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License">
    <img src="https://img.shields.io/badge/models-Claude%20%7C%20Gemini%20%7C%20Codex-purple.svg" alt="Claude | Gemini | Codex">
    <img src="https://img.shields.io/badge/MCP-compatible-orange.svg" alt="MCP Compatible">
  </p>
</p>

---

> **One AI reviewer has blind spots. Three AI reviewers have consensus.**

`triage` runs Claude (Anthropic), Gemini (Google), and Codex (OpenAI) **in parallel** against your codebase. Each model independently analyzes your code, then triage merges their findings — deduplicating overlaps, surfacing consensus, and flagging disagreements. The result is a single prioritized report where the issues that matter rise to the top.

```bash
pip install triage && triage "find security vulnerabilities"
```

That's it. No config files. No API keys to manage. No setup. It uses the AI CLIs you already have installed.

## Why triage?

### The problem with single-model code review

Every AI model has different strengths and blind spots. Ask Claude, Gemini, and Codex to review the same code and you'll get three different reports with some overlap and some unique finds. Manually comparing those reports is tedious and error-prone.

### What triage does differently

**triage is the only tool that runs multiple AI models in parallel and merges their output into a single, deduplicated report with consensus scoring.**

| What | How |
|------|-----|
| **3 models, 1 report** | Claude, Gemini, and Codex analyze your code simultaneously. You get one merged report, not three separate ones to compare. |
| **Consensus = confidence** | When 2 or 3 models independently flag the same issue, it's marked as consensus. These are your highest-confidence findings — the ones most likely to be real bugs, not hallucinations. |
| **Conflicts surface disagreements** | When models disagree on severity (e.g., Claude says S0 blocker, Codex says S2 medium), triage flags it so you can make the call. |
| **Parallel, not sequential** | All models run at the same time via asyncio. Three opinions in the time it takes to get one. |
| **Zero config** | Point it at your repo and describe what you want. triage auto-discovers relevant files, reads your git diff, and redacts secrets before any model sees your code. |
| **Not a linter** | Linters enforce style rules. triage finds logic bugs, security vulnerabilities, race conditions, architectural issues — the things that are hard to write rules for. |

### What each model brings

- **Claude** (Anthropic) — Deep architectural reasoning, nuanced security analysis, strong understanding of complex control flow
- **Gemini** (Google) — Pattern recognition across large codebases, edge case detection, thorough documentation review
- **Codex** (OpenAI) — Practical code understanding, concrete fix suggestions, strong on common vulnerability patterns

You don't need all three. Use `--models claude` for a quick single-model check, or `--models claude,gemini` for faster consensus with two models. But when it matters — security audits, pre-release reviews, unfamiliar codebases — three models catch what one misses.

## Features

- **Parallel AI analysis** — Claude, Gemini, and Codex run concurrently, not sequentially. Three reviews in the time of one.
- **Consensus detection** — Issues found by 2+ models are highlighted. High confidence, low false positive rate.
- **Conflict detection** — Surfaces disagreements between models so you can make informed decisions.
- **Smart context gathering** — Auto-discovers relevant files from your prompt, git diff, directory structure, and keywords. No file lists to maintain.
- **Secret redaction** — API keys, passwords, private keys, and credentials are stripped before any model sees your code. Your secrets never leave your machine.
- **Auto-patching** — Models propose unified diffs, safely applied on a new git branch. Preview with `--dry-run`.
- **MCP server** — First-class support for Claude Desktop, Claude Code, Cursor, Windsurf, Cline, VS Code, Zed, and any MCP-compatible client.
- **Structured output** — Markdown reports for humans, JSON for CI/CD pipelines and automation.
- **Severity classification** — Findings ranked S0 (blocker) through S3 (style) for clear prioritization.
- **Cross-model memory** — Save findings to `CLAUDE.md`, `GEMINI.md`, and `AGENTS.md` so every AI tool in your project remembers what triage found. Use `--remember` to write, `--forget` to clear.
- **Works with what you have** — Uses the AI CLIs already on your machine. No API keys to configure, no cloud service to sign up for.

## Installation

### One-liner (recommended)

```bash
pip install triage && triage "hello world"
```

Or with [pipx](https://pipx.pypa.io/) for isolated install (no venv needed):

```bash
pipx install triage
```

### From GitHub

```bash
pip install git+https://github.com/wyman101/triage-ai.git
```

### With MCP server support

```bash
pip install "triage[mcp]"
```

### Prerequisites

You need at least one AI CLI installed and authenticated. triage works with any combination — use all three for consensus, or just one for quick checks.

| Model | CLI | Install |
|-------|-----|---------|
| **Claude** (Anthropic) | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` |
| **Gemini** (Google) | [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` |
| **Codex** (OpenAI) | [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` |

## Quick Start

### 1. Install

```bash
pip install triage
```

### 2. Run

```bash
cd your-project
triage "find bugs and security issues"
```

That's it. triage auto-discovers your files, runs Claude + Gemini + Codex in parallel, and prints a merged report with consensus findings.

### 3. More Examples

```bash
# Use specific models (faster)
triage --models claude,gemini "review for SQL injection"
triage --models claude "quick single-model scan"

# Review only uncommitted changes (great before a commit)
triage --diff-only "check my changes for bugs"

# Save report to file
triage --out report.md "full security audit"

# Auto-fix with patches
triage --dry-run "fix the XSS vulnerability"     # preview first
triage --apply "fix the SQL injection"             # apply on new branch

# Save findings so Claude/Gemini/Codex remember them
triage --remember "pre-launch security audit"
```

## Recommended Use: Validate AI Plans Before You Build

The highest-value way to use triage is **after an AI proposes a plan but before you implement it**.

AI coding tools like Claude Code, Cursor, Windsurf, and Copilot often generate implementation plans — a set of proposed changes, a refactoring strategy, or an architecture for a new feature. These plans look reasonable, but a single model has blind spots. triage lets you get a second and third opinion before you invest time building.

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
triage "review the implementation plan in /path/to/plan.md — \
  check for security gaps, missing edge cases, scalability issues, \
  and suggest improvements before I start building"
```

**Review a plan after Claude Code's plan mode:**

```bash
# Claude Code saves plans to .claude/ — pass it directly
triage "review /home/user/project/.claude/plan.md — \
  is this the right approach? what's missing? what could go wrong?"
```

**Review a diff after AI-generated code:**

```bash
# AI already wrote the code — review the changes before committing
triage --diff-only "an AI generated these changes. review for \
  correctness, security, and edge cases before I commit"
```

**Review and remember — so the implementing AI knows the risks:**

```bash
# Review the plan AND save findings to AI memory
triage --remember "review /path/to/plan.md for risks and improvements"

# Now when you tell Claude/Gemini/Codex to implement,
# they see the triage findings in their memory files
# and avoid the flagged issues
```

### Why this works

| Without triage | With triage |
|---------------|-------------|
| One model proposes, one model implements — same blind spots | Three models independently review the plan |
| Bugs ship because the implementing AI had the same gaps as the planning AI | Consensus findings surface real issues before any code is written |
| You find problems after building | You find problems before building |
| Fixing is expensive (rewrite) | Fixing is cheap (edit the plan) |

## Example Output

Running `triage "find security issues in the login system"` produces a report like this:

```markdown
# Code Triage Report

**Generated:** 2025-06-15 14:32:01
**Duration:** 47.3s
**Models:** claude, gemini, codex

## Summary

- **Total Issues:** 8
- **Consensus (2+ models):** 3
- **Blockers (S0):** 1
- **High (S1):** 3
- **Medium (S2):** 2
- **Low (S3):** 2

### Model Assessments

**CLAUDE:** Found critical SQL injection in user lookup query and two
authentication bypass vectors. Session handling lacks CSRF protection.

**GEMINI:** Identified SQL injection in login query, weak password hashing
(MD5), and missing rate limiting on the login endpoint.

**CODEX:** Detected SQL injection vulnerability, plaintext password
comparison fallback, and missing input sanitization on username field.

## Blockers (S0)

### 1. SQL Injection in User Lookup [CONSENSUS]

- **Severity:** S0
- **Confidence:** high
- **Category:** security
- **Location:** `auth/login.py:47-52`
- **Models:** claude, gemini, codex

**Evidence:**
​```python
query = f"SELECT * FROM users WHERE username = '{username}'"
cursor.execute(query)
​```

**Recommendation:** Use parameterized queries to prevent SQL injection.

**Proposed fix:**
​```diff
- query = f"SELECT * FROM users WHERE username = '{username}'"
- cursor.execute(query)
+ query = "SELECT * FROM users WHERE username = %s"
+ cursor.execute(query, (username,))
​```

## Consensus Findings

*Issues identified by 2+ models:*

- [S0] **SQL Injection in User Lookup** (auth/login.py) - *claude, gemini, codex*
- [S1] **Weak Password Hashing** (auth/utils.py) - *gemini, codex*
- [S1] **Missing Rate Limiting** (auth/login.py) - *claude, gemini*

## Recommended Plan

1. **[BLOCKER]** SQL Injection in User Lookup - auth/login.py (consensus)
2. **[HIGH]** Weak Password Hashing - auth/utils.py (consensus)
3. **[HIGH]** Missing Rate Limiting - auth/login.py (consensus)
```

**Key things to notice:**
- The SQL injection was found by **all three models** — high confidence it's real, not a hallucination
- Each model's unique perspective is preserved in Model Assessments
- The **Consensus Findings** section gives you a prioritized shortlist of what to fix first
- Patches are included as unified diffs you can apply directly

## Use with Your Editor

### MCP Server

triage includes a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server, making it available as a tool in any MCP-compatible AI coding assistant.

Add to your editor's MCP configuration:

```json
{
  "mcpServers": {
    "triage": {
      "command": "python",
      "args": ["-m", "triage_cli.mcp_server"]
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
triage --format json --out triage-report.json "security audit" \
  && python -c "
import json, sys
report = json.load(open('triage-report.json'))
if report['summary']['blockers'] > 0:
    print(f'BLOCKED: {report[\"summary\"][\"blockers\"]} blocker(s) found')
    sys.exit(1)
print('No blockers found')
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
│        Parallel Execution (asyncio)      │
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
triage [PROMPT] [OPTIONS]
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

## Smart Context Discovery

You don't need to tell triage which files to look at. It figures it out:

| Source | How It Works |
|--------|-------------|
| **Explicit paths** | Paths mentioned in your prompt are read directly |
| **Git diff** | Changed files get priority |
| **Keyword search** | Words from your prompt are matched against filenames and file contents |
| **Entrypoints** | Standard files like `main.py`, `app.py`, `pyproject.toml` are included automatically |

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

When you run `triage --remember`, findings are written into all three files using HTML comment markers (`<!-- triage:start -->` / `<!-- triage:end -->`). This means:

1. **Every AI tool knows about the issues** — Claude, Gemini, and Codex all see the findings next time you use them
2. **Re-running replaces, not appends** — The triage section is swapped out on each run, keeping memory current
3. **Your existing content is preserved** — triage only touches the section between its markers
4. **Clean removal** — `triage --forget` removes the triage section from all files, leaving everything else intact

### What gets written

```markdown
<!-- triage:start -->

## Triage Findings

*Last run: 2025-06-15 14:32 — 8 issues found, 3 consensus*

> **Scope:** find security vulnerabilities in the login system

### Blockers (must fix)

- **[S0] SQL Injection in User Lookup** **(consensus)**
  - Location: `auth/login.py:47-52`
  - Models: claude, gemini, codex
  - Fix: Use parameterized queries to prevent SQL injection.

### Patterns to Watch

These issues were flagged by multiple models — avoid introducing similar patterns:

- **SQL Injection in User Lookup**: Use parameterized queries
- **Weak Password Hashing**: Migrate from MD5 to bcrypt or argon2

<!-- triage:end -->
```

### Why this matters

Without `--remember`, triage findings exist only in the report. The next time you (or an AI) write code in this project, the same mistakes can be reintroduced. With `--remember`, every AI tool in your workflow is aware of the findings and actively avoids repeating them.

## Configuration

Override which CLI commands triage calls:

```bash
export TRIAGE_CLAUDE_CMD="claude"       # default: claude
export TRIAGE_GEMINI_CMD="gemini"       # default: gemini
export TRIAGE_CODEX_CMD="codex"         # default: codex
```

## Use Cases

| Scenario | Command |
|----------|---------|
| **Pre-commit review** | `triage --diff-only "review my changes for bugs"` |
| **Security audit** | `triage "OWASP Top 10 vulnerability scan"` |
| **Performance review** | `triage "find N+1 queries and memory leaks"` |
| **Code quality check** | `triage "check for code smells and anti-patterns"` |
| **Bug investigation** | `triage "why is the checkout flow failing for guest users?"` |
| **Dependency audit** | `triage "check dependencies for known CVEs"` |
| **Pre-merge gate** | `triage --format json --out report.json "security check"` |

### Real-World Workflows

#### Validate an AI-generated plan before launch

You used Claude, Cursor, or Copilot to build a feature. Before you ship it, have three independent models check the work:

```bash
# AI built the feature — now let three other AIs review it
triage --diff-only "I just built a payment integration using Stripe. \
  Review for security issues, edge cases, and anything that could \
  break in production before I launch."
```

This catches the things a single model misses in its own output — the hallucinated error handling, the missing edge case, the SQL injection it accidentally introduced. It's a second (and third) opinion on AI-generated code.

#### Pre-commit sanity check

Run triage on every significant change before you commit. Catches bugs while the context is fresh:

```bash
# Review just your uncommitted changes
triage --diff-only "check for bugs, security issues, and missing error handling"
```

#### Audit an unfamiliar codebase

Joining a new project or inheriting legacy code? Get a fast overview of where the risks are:

```bash
# Point triage at the whole project
triage --max-files 100 "audit this codebase for security vulnerabilities, \
  code quality issues, and technical debt. What should I fix first?"
```

#### Pre-release security gate

Before every release, run a full security sweep. Use JSON output to integrate with your deployment pipeline:

```bash
triage --format json --out pre-release-audit.json \
  "full OWASP Top 10 security audit — check authentication, \
  authorization, injection, XSS, CSRF, and data exposure"
```

#### Review AI-to-AI code

When one AI writes code and another AI reviews it, blind spots cancel out. Use triage as the reviewer step in any AI coding workflow:

```bash
# Step 1: Claude builds the feature (in Claude Code, Cursor, etc.)
# Step 2: triage reviews with all three models
triage "review the code that was just written. Check for correctness, \
  security, edge cases, and whether the implementation matches \
  the intended behavior."
```

#### Focused single-file deep dive

When you know exactly where the problem is:

```bash
triage --max-files 5 "deep review /src/auth/oauth.py — check for \
  token handling issues, session fixation, and PKCE implementation"
```

#### Remember findings across sessions

Use `--remember` to write findings into AI memory files. Next time you open Claude, Gemini, or Codex in this project, they'll know about the issues triage found:

```bash
# Run triage and save findings to CLAUDE.md, GEMINI.md, AGENTS.md
triage --remember "full security and code quality audit"
```

Now when you open Claude Code in this project, it sees the triage findings in `CLAUDE.md` and avoids reintroducing the same patterns. Same for Gemini (via `GEMINI.md`) and Codex (via `AGENTS.md`).

```bash
# Clear triage findings from memory files when issues are resolved
triage --forget
```

## Development

```bash
git clone https://github.com/wyman101/triage-ai.git
cd triage
pip install -e ".[dev]"
pytest -v
```

### Project Structure

```
triage_cli/
├── __main__.py       # CLI entry point & argument parser
├── mcp_server.py     # MCP server for editor integration
├── repo_scan.py      # Context gathering & secret redaction
├── merge.py          # Finding deduplication & consensus
├── report.py         # Markdown & JSON report generation
├── patch.py          # Safe patch application
├── models/
│   ├── base.py       # Base model interface & prompt template
│   ├── claude.py     # Claude (Anthropic) adapter
│   ├── gemini.py     # Gemini (Google) adapter
│   └── codex.py      # Codex (OpenAI) adapter
└── tests/
    └── test_merge.py # Merge engine tests
```

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
