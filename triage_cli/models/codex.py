"""
Codex model adapter.

Uses the Codex CLI for analysis.
"""

import os
from .base import SubprocessModel


class CodexModel(SubprocessModel):
    """Adapter for Codex (OpenAI) CLI."""

    def __init__(self):
        super().__init__()
        self.name = "codex"
        self.cmd_env_var = "TRIAGE_CODEX_CMD"
        self.default_cmd = ["codex"]

    def _build_command(self, prompt_file: str) -> list[str]:
        """Build Codex CLI command."""
        # Codex CLI: exec subcommand, --skip-git-repo-check, prompt as arg
        # Matching the working verify_system.sh pattern
        cmd_str = f"codex exec --skip-git-repo-check \"$(cat '{prompt_file}')\""
        return ["bash", "-c", cmd_str]
