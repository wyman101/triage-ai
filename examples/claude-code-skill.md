# Triage — Run parallel AI code analysis with Claude, Gemini and Codex

## Setup

Save this file as `~/.claude/commands/triage.md` to use as `/triage` in Claude Code.

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

triage "$PROMPT" --nice 10 --timeout 300 --verbose
```
