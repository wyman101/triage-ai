# triage-ai

**Multi-model AI code review. Run Claude Code, Gemini CLI and OpenAI Codex in parallel — each independently explores your codebase, then triage merges their findings into one prioritized report.**

![Node.js 18+](https://img.shields.io/badge/node-18+-green.svg) ![npm](https://img.shields.io/npm/v/triage-ai.svg) ![MIT License](https://img.shields.io/badge/license-MIT-green.svg) ![Claude | Gemini | Codex](https://img.shields.io/badge/models-Claude%20%7C%20Gemini%20%7C%20Codex-purple.svg) ![MCP Compatible](https://img.shields.io/badge/MCP-compatible-orange.svg)

---

```bash
npm install -g triage-ai
triage-ai "find security vulnerabilities"
```

## How It Works

1. **Each AI agent explores your codebase independently** — reading files, following imports, searching for patterns. They're not limited to what the scanner finds; they run in read-only mode and can investigate anything in your repository.
2. **Findings are merged** — identical issues from 2+ models become **consensus** findings (high confidence, low false positives). Severity disagreements are flagged as conflicts for you to decide.
3. **One prioritized report** — S0 (blockers) through S3 (style), with patches in unified diff format.

You need at least one AI CLI installed. Three catch what one misses.

## What It Does

- **Security audits** — SQL injection, XSS, command injection, auth bypass, hardcoded secrets
- **Bug detection** — logic errors, race conditions, null references, missing error handling
- **Second-opinion on AI plans** — before implementing what Claude/Gemini/Copilot proposed, get independent multi-model review
- **Architecture analysis** — agents explore the full codebase to understand context, not just individual files
- **Consensus scoring** — when multiple models independently flag the same issue, confidence is high
- **Conflict detection** — when models disagree on severity, you get both perspectives
- **Auto-patching** — models propose unified diffs, applied safely on a new git branch (`--dry-run` to preview)
- **AI memory** — `--remember` saves findings to CLAUDE.md / GEMINI.md / AGENTS.md so every AI tool in your project knows what triage found

## Safety Model

Each AI CLI runs in **non-interactive pipe mode** — they can read and explore your codebase but cannot modify it:

| CLI | Mode | What Happens |
|-----|------|-------------|
| Claude Code | `-p` (print mode) | Reads files, searches, analyzes — no interactive writes |
| Gemini CLI | `-p` (print mode) | Reads files, searches, analyzes — no interactive writes |
| OpenAI Codex | `--sandbox read-only` | Full auto-approve in a read-only sandbox — cannot write |

Secrets (API keys, passwords, private keys, AWS credentials) are redacted from any context sent to the models. Sensitive files (`.env`, credentials, binaries) are excluded automatically.

## Install

```bash
npm install -g triage-ai
triage-ai setup              # detects installed CLIs, offers to install missing ones
```

Requires [Node.js](https://nodejs.org/) 18+ and at least one AI CLI:

| Model | Install | Auth |
|-------|---------|------|
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | `claude` (interactive login) |
| **Gemini CLI** | `npm install -g @google/gemini-cli` | `gemini` (interactive login) |
| **OpenAI Codex** | `npm install -g @openai/codex` | `codex` (interactive login or `OPENAI_API_KEY`) |

## Usage

```bash
cd your-project

# Full 3-model review
triage-ai "find bugs and security issues"

# Single model, quick check
triage-ai --models claude "quick security scan"

# Review only uncommitted changes
triage-ai --diff-only "check my changes for bugs"

# Save report + remember findings
triage-ai --remember --out report.md "full security audit"

# Preview patches without applying
triage-ai --dry-run "fix the SQL injection"
```

### Second-opinion on AI plans

A standout use case: get a multi-model review of plans proposed by an AI before you implement them.

When Claude, Gemini, Copilot or any AI coding assistant proposes a plan — a refactor, a new feature, an architecture change — run triage to get independent second opinions before committing to it:

```bash
# After Claude proposes changes in plan mode
triage-ai "Claude proposed the following plan — review it for correctness, \
  security risks, edge cases and anything it might have missed: \
  [paste or describe the plan]"

# Review AI-generated code that's been staged
triage-ai --diff-only "an AI generated these changes — review for bugs and security"

# Validate a migration plan
triage-ai "Review this database migration plan for data loss risks, \
  missing rollback steps and performance issues"
```

Each model independently evaluates the plan against your actual codebase — exploring files, checking assumptions, and flagging issues the proposing AI may have overlooked. Consensus findings (flagged by 2+ models) are especially worth paying attention to.

## Example Output

```
┌ triage-ai v1.0.7
│
├ Intake
│  ✓ Scanned repository          42 files, 3 modified
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
│
├ Report
│  ✓ Generated report             3 blockers, 5 high, 8 medium, 6 low
│
└ Done in 52.3s — 22 findings, 4 consensus
```

## CLI Reference

```
triage-ai [PROMPT] [OPTIONS]
triage-ai setup                  # detect CLIs, install missing, show auth hints
```

| Option | Default | Description |
|--------|---------|-------------|
| `--models` | `claude,gemini,codex` | Which models to use (comma-separated) |
| `--diff-only` | off | Only analyze git diff |
| `--max-files` | 200 | Max files in initial context (agents explore beyond this) |
| `--format` | `md` | Output format: `md` or `json` |
| `--out` | stdout | Write report to file |
| `--apply` | off | Apply patches (creates git branch first) |
| `--dry-run` | off | Preview patches without applying |
| `--timeout` | 300 | Per-model timeout in seconds |
| `--remember` | off | Save findings to CLAUDE.md, GEMINI.md, AGENTS.md |
| `--forget` | — | Remove triage findings from memory files |
| `--verbose` | off | Detailed progress output |
| `--mcp` | — | Start as MCP server |

## Severity Levels

| Level | Name | Examples |
|-------|------|---------|
| **S0** | Blocker | SQL injection, RCE, auth bypass, data loss |
| **S1** | High | Logic bugs, race conditions, XSS |
| **S2** | Medium | N+1 queries, missing validation |
| **S3** | Low | Naming conventions, dead code |

## MCP Server

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

Works with Claude Desktop, Claude Code, Cursor, Windsurf, Cline, VS Code (Copilot), Zed, and Continue.

### Claude Code Slash Command

```bash
cp examples/claude-code-skill.md ~/.claude/commands/triage.md
```

Then use `/triage "find security issues"` in Claude Code.

## Configuration

```bash
export TRIAGE_CLAUDE_CMD="claude"              # override CLI command
export TRIAGE_GEMINI_CMD="gemini"
export TRIAGE_CODEX_CMD="codex"
export TRIAGE_GEMINI_MODEL="gemini-2.5-pro"    # override Gemini model
```

## Disclaimer

triage-ai is a wrapper that orchestrates third-party AI CLI tools. By using it, you acknowledge:

- **Your code is sent to external AI services** (Anthropic, Google, OpenAI) via their respective CLI tools. Each service's terms of service and privacy policy apply.
- **AI analysis is not a substitute for professional security audits.** Findings may contain false positives or miss real vulnerabilities. Always verify AI-generated findings and patches before applying them.
- **No warranty.** This tool is provided as-is under the MIT license. The authors are not responsible for any damages, data loss, or security incidents arising from its use.
- **Patches are best-effort.** Always review AI-suggested patches before applying. Use `--dry-run` first.

## Development

```bash
git clone https://github.com/wyman101/triage-ai.git
cd triage-ai && npm install && npm run build
```

## License

MIT
