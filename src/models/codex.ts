/**
 * Codex model adapter.
 *
 * Uses the Codex CLI for analysis.
 * Prompt is passed via stdin using `-` as the prompt argument to avoid
 * E2BIG errors when the context is large (>128KB).
 *
 * Ported from triage_cli/models/codex.py
 */

import { SubprocessModel } from './base.js';

export class CodexModel extends SubprocessModel {
  constructor() {
    super();
    this.name = 'codex';
    this.cmdEnvVar = 'TRIAGE_CODEX_CMD';
    this.defaultCmd = ['codex'];
  }

  /**
   * Build Codex CLI command.
   *
   * Uses --full-auto for non-interactive operation.
   * No sandbox restriction — Codex can explore the filesystem freely.
   * Prompt is read from stdin (base class writes it); `-` tells codex to read
   * the prompt from stdin instead of expecting a positional argument.
   */
  _buildCommand(_promptFile: string): {
    cmd: string[];
    env: Record<string, string | undefined>;
  } {
    const cmd = [...this.command, 'exec', '--full-auto', '--skip-git-repo-check', '-'];
    return {
      cmd,
      env: {},
    };
  }
}
