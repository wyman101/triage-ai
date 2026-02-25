# Triage — Run parallel AI code analysis with Claude, Gemini and Codex

## Setup

Save this file as `~/.claude/commands/triage.md` to use as `/triage` in Claude Code.

## Behavior

When running triage, follow these guidelines:

### Before running
Tell the user: "Running triage with Claude, Gemini and Codex in parallel. Each model will analyze the codebase independently, then findings are merged and deduplicated."

### Interpreting output
The CLI outputs a progress display followed by a markdown report. Watch for:

- **Auth failures**: If you see "not authenticated" or "rate limited" for a model, tell the user the specific fix:
  - Claude: `claude auth login`
  - Gemini: `gemini auth login`
  - Codex: `codex` interactively, or set `OPENAI_API_KEY`
- **Severity levels**: S0 = blockers (fix immediately), S1 = high, S2 = medium, S3 = low
- **Consensus findings**: Issues found by 2+ models — these are highest confidence
- **Conflicts**: When models disagree on severity, note both perspectives
- **Prose responses**: If a model returns "prose response, not JSON" it means the model responded but could not produce structured findings — mention this to the user
- **Context truncation**: If you see "context truncated", warn the user that large files or diffs were cut short and findings may be incomplete

### After triage completes
1. Summarize: "X models completed, Y findings total, Z consensus"
2. If any model failed, explain why and how to fix it (auth, rate limit, timeout)
3. Present S0/S1 findings first with full detail
4. For S2/S3, provide a brief list unless the user asks for detail
5. If patches were generated, offer to show or apply them
6. Highlight consensus findings (agreed by 2+ models) as highest priority

## Execute

```bash
PROMPT="$ARGUMENTS"
if [ -z "$PROMPT" ]; then
    echo "Usage: /triage \"<your analysis prompt>\""
    echo ""
    echo "Examples:"
    echo "  /triage \"find security vulnerabilities\""
    echo "  /triage \"review authentication flow for bugs\""
    echo "  /triage \"check for performance issues\""
    exit 1
fi

triage-ai "$PROMPT" --nice 10 --timeout 300 --verbose
```
