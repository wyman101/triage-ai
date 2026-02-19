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
     * Default: --full-auto --sandbox read-only — full codebase exploration
     * (read files, search) while preventing any writes.
     * Context-only: plain exec mode — minimal flags, analyses only the provided context.
     * We read the prompt file synchronously and pass the text directly —
     * no shell expansion, no bash -c.
     */
    _buildCommand(promptFile: string): {
        cmd: string[];
        env: Record<string, string | undefined>;
    };
}
//# sourceMappingURL=codex.d.ts.map