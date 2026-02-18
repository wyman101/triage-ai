# triage-ai

**Multi-model code triage — run Claude, Gemini, and Codex in parallel to analyze your codebase.**

Three AI models review your code simultaneously, then findings are merged with consensus detection. When Claude, Gemini, *and* Codex all flag the same issue, you know it's real.

## Features

- **Parallel execution** — Claude, Gemini, and Codex run simultaneously via asyncio
- **Consensus detection** — Issues found by 2+ models are highlighted
- **Conflict detection** — Flags when models disagree on severity
- **Auto-context gathering** — Discovers relevant files from your prompt, git diff, and directory structure
- **Secret redaction** — API keys, passwords, and private keys are stripped before models see your code
- **Patch generation** — Models can propose unified diffs, applied safely on a new git branch
- **Multiple output formats** — Markdown reports or structured JSON

## Installation

### Option 1: CLI (recommended)

```bash
pip install triage-ai
```

### Option 2: MCP Server

```bash
pip install triage-ai[mcp]
```

### Option 3: Claude Code Skill

Copy [`examples/claude-code-skill.md`](examples/claude-code-skill.md) to `~/.claude/commands/triage.md`, then use `/triage` in Claude Code.

### Prerequisites

You need at least one of these AI CLIs installed and authenticated:

| CLI | Install |
|-----|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @anthropic-ai/gemini-cli` |
| [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` |

## Usage

### CLI

```bash
# All three models (default)
triage "find security vulnerabilities in the authentication system"

# Pick specific models
triage --models claude,gemini "review the database queries for SQL injection"
triage --models claude "quick single-model review"

# Analyze only uncommitted changes
triage --diff-only "review my changes before commit"

# Output to file
triage --out report.md "audit the API layer"
triage --format json --out report.json "find performance issues"

# Patches
triage --dry-run "fix the XSS vulnerability"    # Preview patches
triage --apply "fix the SQL injection"            # Apply on new branch
```

### MCP Server

Add to your MCP client config (Claude Desktop, Claude Code, Cursor, etc.):

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

See [`examples/mcp-config.json`](examples/mcp-config.json) for a complete example.

### Claude Code Skill

```
/triage "find security issues in authentication"
/triage "check for hardcoded values"
```

## How It Works

```
┌─────────────┐
│  Your Prompt │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────────────────────────┐
│  Repo Scan  │────▶│ Files, git diff, tree, secrets    │
└──────┬──────┘     │ redacted before models see code   │
       │            └──────────────────────────────────┘
       ▼
┌──────────────────────────────────────┐
│         Parallel Execution           │
│  ┌─────────┐ ┌────────┐ ┌─────────┐ │
│  │ Claude  │ │ Gemini │ │  Codex  │ │
│  └────┬────┘ └───┬────┘ └────┬────┘ │
│       │          │           │       │
└───────┼──────────┼───────────┼───────┘
        │          │           │
        ▼          ▼           ▼
┌──────────────────────────────────────┐
│       Merge & Deduplicate            │
│  • Cluster similar findings          │
│  • Detect consensus (2+ models)      │
│  • Flag conflicts & disagreements    │
│  • Aggregate patches                 │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│            Report                    │
│  Markdown or JSON with:             │
│  • Findings by severity (S0-S3)     │
│  • Consensus highlights             │
│  • Proposed patches                 │
│  • Recommended action plan          │
└──────────────────────────────────────┘
```

## Severity Levels

| Level | Name | Description |
|-------|------|-------------|
| S0 | Blocker | Security vulnerabilities, crashes, data loss |
| S1 | High | Bugs, significant issues |
| S2 | Medium | Code quality, performance |
| S3 | Low | Style, minor improvements |

## CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--models` | `claude,gemini,codex` | Comma-separated models to use |
| `--diff-only` | off | Only send git diff, not full files |
| `--max-files` | 30 | Maximum files to analyze |
| `--format` | `md` | Output format: `md` or `json` |
| `--out` | stdout | Write report to file |
| `--apply` | off | Apply patches (creates git branch) |
| `--dry-run` | off | Preview patches without applying |
| `--timeout` | 300 | Per-model timeout in seconds |
| `--nice` | 10 | CPU priority (higher = lower priority) |
| `--verbose` | off | Show detailed progress |

## Auto-Context Gathering

Triage automatically discovers relevant files based on your prompt:

| Source | What It Finds |
|--------|---------------|
| **Explicit paths** | File/directory paths mentioned in your prompt |
| **Git diff** | Files with uncommitted changes |
| **Keyword search** | Files matching words in your prompt (name + content) |
| **Entrypoints** | `main.py`, `app.py`, `pyproject.toml`, etc. |

### Max Files Guidance

| Query Type | Recommended `--max-files` |
|------------|---------------------------|
| Single file review | 5-10 |
| Feature/module audit | 20-30 (default) |
| Full codebase audit | 50-100 |

## Safety

### Secret Redaction

Automatically stripped before any model sees your code:
- API keys and tokens
- Passwords and credentials
- Private keys (RSA, EC, etc.)
- Database connection strings
- AWS credentials

### File Filtering

Automatically skipped:
- `.env`, `credentials.json`, secrets files
- Binary files (images, executables)
- `node_modules`, `__pycache__`, `.git`

### Patch Safety

- Creates a new git branch before applying
- Dry-runs patches to verify they apply cleanly
- Limits to 5 files per session
- Refuses to patch non-git repos

## Configuration

Override default CLI commands via environment variables:

```bash
export TRIAGE_CLAUDE_CMD="claude"
export TRIAGE_GEMINI_CMD="gemini"
export TRIAGE_CODEX_CMD="codex"
```

## Development

```bash
git clone https://github.com/wyman101/triage-ai.git
cd triage-ai
pip install -e ".[dev]"
pytest -v
```

## License

MIT
