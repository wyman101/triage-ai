---
name: triage
description: Triage — Collaborative AI code review with Claude, Gemini and Codex. Each model independently explores the codebase, then findings are merged with consensus scoring. Use this skill when the user asks to "triage", "run triage", "code review", "security audit", "find bugs", "run a security scan", "second opinion", mentions "triage-ai", or wants collaborative multi-model analysis of their codebase. Also use when the user wants a second opinion on AI-generated code or plans.
version: 1.6.1
---

# Triage — Collaborative AI code review with Claude, Gemini and Codex

Run `triage-ai` to launch Claude Code, Gemini CLI and OpenAI Codex as a collaborative review team. Each model independently explores the codebase, then findings are merged with consensus scoring into one prioritized report. When multiple models independently flag the same issue, confidence is high.

## Prerequisites

triage-ai must be installed globally:

```bash
npm install -g triage-ai
```

At least one AI CLI must be installed and authenticated:
- **Claude Code**: `npm install -g @anthropic-ai/claude-code` then `claude auth login`
- **Gemini CLI**: `npm install -g @google/gemini-cli` then `gemini auth login`
- **OpenAI Codex**: `npm install -g @openai/codex` then set `OPENAI_API_KEY`

Run `triage-ai ready` to verify which models are available.

## How to Run

**IMPORTANT: Run the triage command in the background** using `run_in_background: true` on the Bash tool. This lets you relay progress to the user as it happens instead of showing a truncated bash window.

```bash
triage-ai "<user's prompt>" --nice 10 --timeout 300 --verbose
```

### Common invocations

```bash
# Full 3-model review
triage-ai "find bugs and security issues"

# Single model, quick check
triage-ai --models claude "quick security scan"

# Review only uncommitted changes
triage-ai --diff-only "check my changes for bugs"

# Save report + remember findings in project memory
triage-ai --remember --out report.md "full security audit"

# Preview patches without applying
triage-ai --dry-run "fix the SQL injection"

# Restrict models to pre-gathered context only (faster, no filesystem exploration)
triage-ai --context-only "review this code for issues"
```

## While triage is running

1. Tell the user: "Running triage with Claude, Gemini and Codex in parallel — I'll relay progress as each model completes."
2. Check the output file periodically (every 15-20s) to relay status updates
3. Look for these markers in the output:
   - `=== triage-ai vX.Y.Z ===` = startup confirmed (version check)
   - `[phase:N/6] name — Title` = phase transition (N of 6 total phases)
   - `[assess] ModelName…` = model still running (with elapsed time)
   - `[assess] ModelName ✓` = model completed (with finding count and time)
   - `[assess] ModelName ✗` = model failed (with error hint)
   - `=== TRIAGE COMPLETE ===` = all done — read full output
   - `=== REPORT START ===` / `=== REPORT END ===` = report body delimiters
4. When you see a model complete, tell the user immediately, e.g. "Codex finished — 5 findings in 12.3s"

## Interpreting results

- **Auth failures**: If a model shows "not authenticated" or "rate limited", tell the user the fix:
  - Claude: `claude auth login`
  - Gemini: `gemini auth login`
  - Codex: `codex` interactively, or set `OPENAI_API_KEY`
- **Severity levels**: S0 = blockers (fix now), S1 = high, S2 = medium, S3 = low
- **Consensus findings** (2+ models agree): highest confidence — present these first
- **Prose responses**: "(prose)" in model results means the model responded but couldn't produce structured findings
- **Context truncation**: `⚠ Context was truncated` in summary means large files were cut short — warn the user

## After triage completes

1. Show a summary: "X models completed, Y findings (Z consensus)"
2. If any model failed, explain why and how to fix it
3. Present findings in a table: severity, title, consensus status
4. Show S0/S1 findings with full detail
5. For S2/S3, provide a brief list unless the user asks for more
6. If patches were generated, offer to show or apply them
7. **ALWAYS ask the user before implementing any fixes** — never auto-implement
