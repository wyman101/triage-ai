/**
 * Claude model adapter.
 *
 * Uses the Claude CLI (claude command) for analysis.
 * Prompt is passed via stdin in -p (print) mode.
 *
 * Ported from triage_cli/models/claude.py
 */
import { SubprocessModel } from './base.js';
export declare class ClaudeModel extends SubprocessModel {
    constructor();
    /**
     * Build Claude CLI command.
     *
     * Uses -p (print) mode for non-interactive pipe operation.
     * CLAUDECODE env var is unset so Claude can run from within Claude Code sessions.
     */
    _buildCommand(_promptFile: string): {
        cmd: string[];
        env: Record<string, string | undefined>;
    };
}
//# sourceMappingURL=claude.d.ts.map