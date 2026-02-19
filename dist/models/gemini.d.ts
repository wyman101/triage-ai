/**
 * Gemini model adapter.
 *
 * Uses the Gemini CLI for analysis.
 * Prompt is passed via stdin.
 *
 * Ported from triage_cli/models/gemini.py
 */
import { SubprocessModel } from './base.js';
export declare class GeminiModel extends SubprocessModel {
    constructor();
    /**
     * Build Gemini CLI command.
     *
     * Default: --approval-mode plan — full codebase exploration (read files,
     * search) while preventing any writes.
     * Context-only: plain -p mode — no tool use, analyses only the provided context.
     * Model selection via TRIAGE_GEMINI_MODEL env var (optional).
     */
    _buildCommand(_promptFile: string): {
        cmd: string[];
        env: Record<string, string | undefined>;
    };
}
//# sourceMappingURL=gemini.d.ts.map