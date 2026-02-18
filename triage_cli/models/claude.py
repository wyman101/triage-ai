"""
Claude model adapter.

Uses the Claude CLI (claude command) for analysis.
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

    def _build_command(self, prompt_file: str) -> list[str]:
        """Build Claude CLI command."""
        # Unset CLAUDECODE so Claude CLI doesn't refuse to start when
        # invoked from within an existing Claude Code session.
        # Claude CLI: -p for print mode, prompt as positional arg, --output-format text
        cmd_str = f"unset CLAUDECODE; claude -p \"$(cat '{prompt_file}')\" --output-format text"
        return ["bash", "-c", cmd_str]
