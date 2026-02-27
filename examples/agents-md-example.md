# Triage AI — Project Instructions for Codex

Copy this file to your project root as `AGENTS.md` so Codex knows how to use triage-ai.

---

## Triage

This project uses [triage-ai](https://github.com/wyman101/triage-ai) for multi-model code analysis.

### Running a triage

```bash
triage-ai "<prompt>" --nice 10 --timeout 300 --verbose
```

Examples:
- `triage-ai "find security vulnerabilities"`
- `triage-ai "review authentication flow for bugs"`
- `triage-ai --diff-only "check my changes for bugs"`
- `triage-ai --remember "full security audit"` (saves findings to AGENTS.md)

### Interpreting results

- **S0** = blockers (fix immediately), **S1** = high, **S2** = medium, **S3** = low
- **Consensus findings** (flagged by 2+ models) have high confidence — prioritize these
- Always ask the user before implementing any fixes from the triage report
