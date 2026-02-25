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
   * Uses -p (print) mode for non-interactive pipe operation.
   * --output-format json wraps the response in a metadata envelope,
   * which lets us detect truncation (incomplete envelope = truncated).
   * --effort high gives Claude more room for thorough analysis.
   * CLAUDECODE env var is unset so Claude can run from within Claude Code sessions.
   */
  _buildCommand(_promptFile: string): {
    cmd: string[];
    env: Record<string, string | undefined>;
  } {
    const cmd = [...this.command, '-p', '--output-format', 'json'];

    // Configurable effort level (default: high for thorough analysis)
    const effort = process.env['TRIAGE_CLAUDE_EFFORT'] ?? 'high';
    if (effort !== 'none') {
      cmd.push('--effort', effort);
    }

    return {
      cmd,
      env: { CLAUDECODE: undefined }, // Unset to allow nested sessions
    };
  }

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
  override parseOutput(output: string): ModelResult {
    const trimmed = output.trim();

    try {
      const envelope = JSON.parse(trimmed) as Record<string, unknown>;

      if (envelope.type === 'result' && typeof envelope.result === 'string') {
        // Successfully unwrapped — parse the inner response
        const result = super.parseOutput(envelope.result);

        // Propagate error status from envelope
        if (envelope.is_error === true && !result.error) {
          result.error = `Claude reported error: ${envelope.subtype ?? 'unknown'}`;
        }

        return result;
      }
    } catch {
      // Envelope parse failed — could be truncated or non-JSON.
      // Check if it looks like a truncated envelope (starts with {"type":"result")
      if (trimmed.startsWith('{"type":"result"') || trimmed.startsWith('{ "type": "result"')) {
        // Truncated envelope — try to extract partial "result" field
        const resultMatch = trimmed.match(/"result"\s*:\s*"([\s\S]*)/);
        if (resultMatch) {
          // Extract everything after "result":" — it's likely truncated
          let inner = resultMatch[1];
          // Remove trailing envelope fields if partially present
          const lastQuote = inner.lastIndexOf('"');
          if (lastQuote > 0) {
            inner = inner.slice(0, lastQuote);
          }
          // Unescape JSON string escapes
          try {
            inner = JSON.parse(`"${inner}"`);
          } catch {
            // Use raw if unescape fails
            inner = inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          }

          const result = super.parseOutput(inner);
          result.output_truncated = true;
          if (!result.error) {
            result.error = 'Claude output was truncated (incomplete JSON envelope)';
          }
          return result;
        }
      }
    }

    // Fallback: treat entire output as raw text (pre-envelope format or unexpected)
    return super.parseOutput(output);
  }
}
