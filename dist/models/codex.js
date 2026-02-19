/**
 * Codex model adapter.
 *
 * Uses the Codex CLI for analysis.
 * Prompt is read from the temp file and passed as a positional argument —
 * no shell expansion, no bash -c.
 *
 * Ported from triage_cli/models/codex.py
 */
import { readFileSync } from 'node:fs';
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
     * Uses --full-auto --sandbox read-only for non-interactive read-only operation.
     * We read the prompt file synchronously and pass the text directly —
     * no shell expansion, no bash -c.
     */
    _buildCommand(promptFile) {
        const promptText = readFileSync(promptFile, 'utf8');
        const cmd = ['codex', 'exec', '--full-auto', '--sandbox', 'read-only', '--skip-git-repo-check', promptText];
        return {
            cmd,
            env: {},
        };
    }
}
//# sourceMappingURL=codex.js.map