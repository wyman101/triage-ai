"""
Claude model adapter.

Uses the Claude CLI (claude command) for analysis.
Prompt is passed via stdin in -p (print) mode.
"""

import os
from .base import SubprocessModel


class ClaudeModel(SubprocessModel):
    """Adapter for Claude CLI."""

    def __init__(self):
        super().__init__()
        self.name = "claude"
        self.cmd_env_var = "TRIAGE_CLAUDE_CMD"
        self.default_cmd = ["claude"]

    def _build_command(self, prompt_file: str) -> tuple[list[str], dict]:
        """Build Claude CLI command.

        Claude -p (print mode) reads from stdin when no positional prompt is given.
        CLAUDECODE env var is unset so Claude can run from within Claude Code sessions.
        """
        return (
            ["claude", "-p", "--output-format", "text"],
            {"CLAUDECODE": None},  # Unset to allow nested sessions
        )
