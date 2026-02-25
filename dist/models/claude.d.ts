/**
 * Claude model adapter.
 *
 * Uses the Claude CLI (claude command) for analysis.
 * Prompt is passed via stdin in -p (print) mode.
 * Output format is JSON — the CLI wraps the response in an envelope
 * with metadata (cost, duration, etc.). We unwrap it in parseOutput().
 *
 * Ported from triage_cli/models/claude.py
 */
import { SubprocessModel } from './base.js';
import type { ModelResult } from '../types.js';
export declare class ClaudeModel extends SubprocessModel {
    constructor();
    /**
     * Build Claude CLI command.
     *
     * Uses -p (print) mode for non-interactive pipe operation.
     * --output-format json wraps the response in a metadata envelope,
     * which lets us detect truncation (incomplete envelope = truncated).
     * --effort high gives Claude more room for thorough analysis.
     * CLAUDECODE env var is unset so Claude can run from within Claude Code sessions.
     */
    _buildCommand(_promptFile: string): {
        cmd: string[];
        env: Record<string, string | undefined>;
    };
    /**
     * Unwrap Claude's JSON envelope before parsing findings.
     *
     * Claude --output-format json produces:
     * {"type":"result","subtype":"success","result":"...","cost_usd":...,...}
     *
     * We extract the "result" field (the actual model response text)
     * and pass it to the standard parseOutput() for JSON finding extraction.
     * If the envelope itself is truncated, we flag it and try to salvage.
     */
    parseOutput(output: string): ModelResult;
}
//# sourceMappingURL=claude.d.ts.map