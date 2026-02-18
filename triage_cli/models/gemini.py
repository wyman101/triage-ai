"""
Gemini model adapter.

Uses the Gemini CLI for analysis.
Prompt is passed via stdin.
"""

import os
from .base import SubprocessModel


class GeminiModel(SubprocessModel):
    """Adapter for Gemini CLI."""

    def __init__(self):
        super().__init__()
        self.name = "gemini"
        self.cmd_env_var = "TRIAGE_GEMINI_CMD"
        self.default_cmd = ["gemini"]

    def _build_command(self, prompt_file: str) -> tuple[list[str], dict]:
        """Build Gemini CLI command.

        Gemini reads from stdin when input is piped.
        Model selection via TRIAGE_GEMINI_MODEL env var (optional).
        """
        model = os.environ.get("TRIAGE_GEMINI_MODEL", "")
        cmd = ["gemini"]
        if model:
            cmd.extend(["-m", model])
        return (cmd, {})
