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
     * Uses -p mode for non-interactive pipe operation.
     * Model selection via TRIAGE_GEMINI_MODEL env var (optional).
     */
    _buildCommand(_promptFile) {
        const model = process.env['TRIAGE_GEMINI_MODEL'] ?? '';
        // -p requires a prompt string argument (yargs string option).
        // Pass empty string — real prompt comes via stdin.
        const cmd = [...this.command, '-p', ''];
        if (model) {
            cmd.push('-m', model);
        }
        return { cmd, env: {} };
    }
}
//# sourceMappingURL=gemini.js.map