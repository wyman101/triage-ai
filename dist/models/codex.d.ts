/**
 * Codex model adapter.
 *
 * Uses the Codex CLI for analysis.
 * Prompt is read from the temp file and passed as a positional argument —
 * no shell expansion, no bash -c.
 *
 * Ported from triage_cli/models/codex.py
 */
import { SubprocessModel } from './base.js';
export declare class CodexModel extends SubprocessModel {
    constructor();
    /**
     * Build Codex CLI command.
     *
     * Uses --full-auto --sandbox read-only for non-interactive read-only operation.
     * We read the prompt file synchronously and pass the text directly —
     * no shell expansion, no bash -c.
     */
    _buildCommand(promptFile: string): {
        cmd: string[];
        env: Record<string, string | undefined>;
    };
}
//# sourceMappingURL=codex.d.ts.map