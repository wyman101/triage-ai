/**
 * Gemini model adapter.
 *
 * Uses the Gemini CLI for analysis.
 * Prompt is passed via stdin.
 *
 * Ported from triage_cli/models/gemini.py
 */
import { SubprocessModel } from './base.js';
export class GeminiModel extends SubprocessModel {
    constructor() {
        super();
        this.name = 'gemini';
        this.cmdEnvVar = 'TRIAGE_GEMINI_CMD';
        this.defaultCmd = ['gemini'];
    }
    /**
     * Build Gemini CLI command.
     *
     * Default: --approval-mode plan — full codebase exploration (read files,
     * search) while preventing any writes.
     * Context-only: plain -p mode — no tool use, analyses only the provided context.
     * Model selection via TRIAGE_GEMINI_MODEL env var (optional).
     */
    _buildCommand(_promptFile) {
        const model = process.env['TRIAGE_GEMINI_MODEL'] ?? '';
        const cmd = ['gemini', '-p'];
        if (!this.contextOnly) {
            cmd.push('--approval-mode', 'plan');
        }
        if (model) {
            cmd.push('-m', model);
        }
        return { cmd, env: {} };
    }
}
//# sourceMappingURL=gemini.js.map