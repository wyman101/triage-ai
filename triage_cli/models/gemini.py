"""
Gemini model adapter.

Uses the Gemini CLI for analysis.
"""

import os
from .base import SubprocessModel


# Use Gemini default model (no -m flag) to avoid rate limits on specific models
GEMINI_MODEL = None  # Set to None to use default model


class GeminiModel(SubprocessModel):
    """Adapter for Gemini CLI."""

    def __init__(self):
        super().__init__()
        self.name = "gemini"
        self.cmd_env_var = "TRIAGE_GEMINI_CMD"
        self.default_cmd = ["gemini"]

    def _build_command(self, prompt_file: str) -> list[str]:
        """Build Gemini CLI command using -p flag for prompt."""
        # Gemini CLI uses -p for prompt input, -m for model (optional)
        # Read prompt from file and pass via -p flag
        model_flag = f"-m {GEMINI_MODEL}" if GEMINI_MODEL else ""
        cmd_str = f"gemini {model_flag} -p \"$(cat '{prompt_file}')\""
        return ["bash", "-c", cmd_str]
