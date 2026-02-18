<p align="center">
  <h1 align="center">triage-ai</h1>
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

Stop trusting a single AI's opinion about your code. **triage-ai** runs Claude (Anthropic), Gemini (Google), and Codex (OpenAI) in parallel against your codebase, then merges their findings with consensus detection. When all three models flag the same bug, you know it's real.

Works as a **CLI tool**, an **MCP server** for AI-native editors, or a **slash command** inside Claude Code.

## Why Multi-Model?

A single AI code reviewer has blind spots. Different models catch different things:

- **Claude** excels at architectural reasoning and security analysis
- **Gemini** is strong on pattern recognition and edge cases
- **Codex** brings deep code understanding and practical fixes

triage-ai runs all three simultaneously and **deduplicates overlapping findings**, **detects consensus** (2+ models agree), and **flags conflicts** when models disagree. The result is a single, prioritized report you can actually act on.

## Features

- **Parallel AI analysis** — Claude, Gemini, and Codex run concurrently via asyncio, not sequentially
- **Consensus detection** — Issues found by 2+ models are highlighted with high confidence
- **Conflict detection** — Surfaces disagreements between models on severity or approach
- **Smart context gathering** — Auto-discovers relevant files from your prompt, git diff, directory structure, and keywords
- **Secret redaction** — API keys, passwords, private keys, and credentials are stripped before any model sees your code
- **Auto-patching** — Models propose unified diffs, safely applied on a new git branch
- **MCP server** — First-class support for Claude Desktop, Claude Code, Cursor, Windsurf, Cline, and any MCP-compatible client
- **Structured output** — Markdown reports for humans, JSON for CI/CD pipelines and automation
- **Severity classification** — Findings ranked S0 (blocker) through S3 (style) for clear prioritization

## Installation

### One-liner (recommended)

```bash
pip install triage-ai && triage "hello world"
```

Or with [pipx](https://pipx.pypa.io/) for isolated install (no venv needed):

```bash
pipx install triage-ai
```

### From GitHub

```bash
pip install git+https://github.com/wyman101/triage-ai.git
```

### With MCP server support

```bash
pip install "triage-ai[mcp]"
```

### Prerequisites

You need at least one AI CLI installed and authenticated. triage-ai works with any combination — use all three for consensus, or just one for quick checks.

| Model | CLI | Install |
|-------|-----|---------|
| **Claude** (Anthropic) | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` |
| **Gemini** (Google) | [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` |
| **Codex** (OpenAI) | [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` |

## Quick Start

```bash
# Run all three models against your codebase
triage "find security vulnerabilities in the authentication system"

# Use specific models
triage --models claude,gemini "review database queries for SQL injection"
triage --models claude "quick single-model security scan"

# Review only uncommitted changes (great for pre-commit)
triage --diff-only "review my changes for bugs before I commit"

# Save the report
triage --out report.md "full security audit"
triage --format json --out report.json "find performance bottlenecks"

# Auto-fix with patches
triage --dry-run "fix the XSS vulnerability in user input"   # preview
triage --apply "fix the SQL injection in the login handler"    # apply on new branch
```

## Use with Your Editor

### MCP Server

triage-ai includes a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server, making it available as a tool in any MCP-compatible AI coding assistant.

Add to your editor's MCP configuration:

```json
{
  "mcpServers": {
    "triage-ai": {
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
| `--verbose` | off | Show detailed progress output |

## Smart Context Discovery

You don't need to tell triage-ai which files to look at. It figures it out:

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

## Configuration

Override which CLI commands triage-ai calls:

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

## Development

```bash
git clone https://github.com/wyman101/triage-ai.git
cd triage-ai
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
