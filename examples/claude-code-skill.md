# Triage — Run parallel AI code analysis with Claude, Gemini and Codex

## Setup

Save this file as `~/.claude/commands/triage.md` to use as `/triage` in Claude Code.

## Behavior

**IMPORTANT: Run the triage command in the background** using `run_in_background: true` on the Bash tool. This lets you relay progress to the user as it happens instead of showing a truncated bash window.

### While triage is running
1. Tell the user: "Running triage with Claude, Gemini and Codex in parallel — I'll relay progress as each model completes."
2. Check the output file periodically (every 15-20s) to relay status updates
3. When you see `[assess] ModelName ✓` lines, tell the user immediately, e.g. "Claude finished — 5 findings in 12.3s"
4. When you see `=== TRIAGE COMPLETE ===`, read the full output and present the report

### Interpreting results
- **Auth failures**: If a model shows "not authenticated" or "rate limited", tell the user the fix:
  - Claude: `claude auth login`
  - Gemini: `gemini auth login`
  - Codex: `codex` interactively, or set `OPENAI_API_KEY`
- **Severity levels**: S0 = blockers (fix now), S1 = high, S2 = medium, S3 = low
- **Consensus findings** (2+ models agree): highest confidence — present these first
- **Prose responses**: "prose response, not JSON" means the model responded but couldn't produce structured findings
- **Context truncation**: warn the user that large files were cut short

### After triage completes
1. Show a summary: "X models completed, Y findings (Z consensus)"
2. If any model failed, explain why and how to fix it
3. Present S0/S1 findings with full detail
4. For S2/S3, provide a brief list unless the user asks for more
5. If patches were generated, offer to show or apply them

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
