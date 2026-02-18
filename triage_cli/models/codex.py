"""
Codex model adapter.

Uses the Codex CLI for analysis.
Prompt is read from a temp file and passed as an argument (no shell expansion).
"""

import os
from pathlib import Path
from .base import SubprocessModel


class CodexModel(SubprocessModel):
    """Adapter for Codex (OpenAI) CLI."""

    def __init__(self):
        super().__init__()
        self.name = "codex"
        self.cmd_env_var = "TRIAGE_CODEX_CMD"
        self.default_cmd = ["codex"]

    def _build_command(self, prompt_file: str) -> tuple[list[str], dict]:
        """Build Codex CLI command.

        Codex exec requires the prompt as a positional argument.
        We read the prompt file in Python and pass it directly —
        no shell expansion, no bash -c.
        """
        prompt_text = Path(prompt_file).read_text()
        return (
            ["codex", "exec", "--skip-git-repo-check", prompt_text],
            {},
        )
