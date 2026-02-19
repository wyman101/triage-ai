/**
 * Claude model adapter.
 *
 * Uses the Claude CLI (claude command) for analysis.
 * Prompt is passed via stdin in -p (print) mode.
 *
 * Ported from triage_cli/models/claude.py
 */

import { SubprocessModel } from './base.js';

export class ClaudeModel extends SubprocessModel {
  constructor() {
    super();
    this.name = 'claude';
    this.cmdEnvVar = 'TRIAGE_CLAUDE_CMD';
    this.defaultCmd = ['claude'];
  }

  /**
   * Build Claude CLI command.
   *
   * Default: --permission-mode plan — full codebase exploration (read files,
   * search, grep) while preventing any writes.
   * Context-only: plain -p mode — no tool use, analyses only the provided context.
   * CLAUDECODE env var is unset so Claude can run from within Claude Code sessions.
   */
  _buildCommand(_promptFile: string): {
    cmd: string[];
    env: Record<string, string | undefined>;
  } {
    const cmd = ['claude', '-p', '--output-format', 'text'];
    if (!this.contextOnly) {
      cmd.push('--permission-mode', 'plan');
    }
    return {
      cmd,
      env: { CLAUDECODE: undefined }, // Unset to allow nested sessions
    };
  }
}
