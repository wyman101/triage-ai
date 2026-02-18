/**
 * Base model interface and subprocess runner.
 *
 * Ported from triage_cli/models/base.py
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  type ModelResult,
  type ScanContext,
  MODEL_PROMPT_TEMPLATE,
  modelResultFromDict,
} from '../types.js';

// ---------------------------------------------------------------------------
// Auth / rate-limit error detection
// ---------------------------------------------------------------------------

/** Patterns in stderr that indicate a CLI auth/quota problem. */
const AUTH_ERROR_PATTERNS: RegExp[] = [
  /not logged in/i,
  /login required/i,
  /please log in/i,
  /authentication (failed|required|error)/i,
  /unauthorized/i,
  /api[_\s-]?key/i,
  /invalid[_\s-]?key/i,
  /missing[_\s-]?key/i,
  /no credentials/i,
  /rate[_\s-]?limit/i,
  /quota exceeded/i,
  /too many requests/i,
  /billing/i,
  /subscription required/i,
];

/**
 * Check collected stderr text for known auth/quota errors.
 * Returns a human-readable error message if found, null otherwise.
 */
function detectAuthError(modelName: string, stderr: string): string | null {
  for (const pattern of AUTH_ERROR_PATTERNS) {
    if (pattern.test(stderr)) {
      return (
        `${modelName} CLI authentication/quota error — ` +
        `please run \`${modelName}\` interactively to log in or check your API key.\n` +
        `Stderr: ${stderr.slice(0, 500)}`
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Abstract base
// ---------------------------------------------------------------------------

export abstract class BaseModel {
  name: string;
  cmdEnvVar: string;
  defaultCmd: string[];

  constructor() {
    this.name = 'base';
    this.cmdEnvVar = 'TRIAGE_BASE_CMD';
    this.defaultCmd = ['echo'];
  }

  /** Get the command to use for this model (env override > default). */
  get command(): string[] {
    const envCmd = process.env[this.cmdEnvVar] ?? '';
    if (envCmd) return envCmd.split(/\s+/);
    return this.defaultCmd;
  }

  /**
   * Run analysis using this model.
   *
   * Builds prompt, saves it for debugging, calls _runModel, parses the
   * result, saves parsed JSON to resultsDir, returns ModelResult.
   */
  async analyze(
    prompt: string,
    context: ScanContext,
    resultsDir: string,
    timeout = 300,
    nice = 10,
  ): Promise<ModelResult> {
    const fullPrompt = this.buildPrompt(prompt, context);

    // Save prompt for debugging
    const promptFile = join(resultsDir, `${this.name}_prompt.txt`);
    await writeFile(promptFile, fullPrompt, 'utf8');

    try {
      const output = await this._runModel(fullPrompt, timeout, nice);

      // Save raw output
      const outputFile = join(resultsDir, `${this.name}_output.txt`);
      await writeFile(outputFile, output, 'utf8');

      // Parse the result
      const result = this.parseOutput(output);
      result.raw_output = output;

      // Save parsed result
      const resultFile = join(resultsDir, `${this.name}_result.json`);
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(resultFile, JSON.stringify(this._resultToDict(result), null, 2), 'utf8');

      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        model: this.name,
        summary: `Error running ${this.name}: ${msg}`,
        findings: [],
        inspected: [],
        questions: [],
        error: msg,
        raw_output: '',
      };
    }
  }

  /** Build the full prompt string from the template and scan context. */
  buildPrompt(prompt: string, context: ScanContext): string {
    // Tree context (directory structure), truncated at 3000 chars
    let treeContext = '';
    if (context.tree) {
      treeContext = `Directory Structure:\n\`\`\`\n${context.tree.slice(0, 3000)}\n\`\`\`\n`;
    }

    // Git context
    let gitContext = '';
    if (context.git_log) {
      gitContext += `Recent Commits:\n\`\`\`\n${context.git_log}\n\`\`\`\n`;
    }
    if (context.has_diff) {
      // Truncate git_diff at 10000 chars
      gitContext += `Git Diff:\n\`\`\`\n${context.git_diff.slice(0, 10000)}\n\`\`\`\n`;
    }
    if (context.git_status) {
      gitContext += `Git Status:\n\`\`\`\n${context.git_status}\n\`\`\`\n`;
    }

    // Files context — each file content truncated at 5000 chars
    let filesContext = '';
    let totalChars = 0;
    for (const f of context.files) {
      const descStr = f.description ? ` - ${f.description}` : '';
      filesContext += `\n--- ${f.path} (${f.reason})${descStr} ---\n`;
      let content = f.content;
      if (content.length > 5000) {
        content = content.slice(0, 5000) + '\n... [truncated]';
      }
      filesContext += `\`\`\`\n${content}\n\`\`\`\n`;
      totalChars += content.length;
    }

    const fileCount = context.files.length;

    // Replace template placeholders — MODEL_PROMPT_TEMPLATE uses {key} syntax
    // and doubled braces {{/}} for literal braces in the JSON schema example.
    return MODEL_PROMPT_TEMPLATE
      .replace('{prompt}', prompt)
      .replace('{root}', context.root)
      .replace('{is_git_repo}', String(context.is_git_repo))
      .replace('{tree_context}', treeContext)
      .replace('{git_context}', gitContext)
      .replace('{files_context}', filesContext)
      .replace('{file_count}', String(fileCount))
      .replace('{total_chars}', String(totalChars))
      .replace('{model_name}', this.name)
      // Unescape the doubled braces that were literal in the template
      .replace(/\{\{/g, '{')
      .replace(/\}\}/g, '}');
  }

  /**
   * Parse raw model output into a ModelResult.
   *
   * Tries in order:
   *   1. JSON inside ```json ... ``` blocks
   *   2. JSON inside ``` ... ``` blocks
   *   3. Raw JSON parse of entire output
   *   4. First `{...}` match in the string
   */
  parseOutput(output: string): ModelResult {
    const patterns: RegExp[] = [
      /```json\s*([\s\S]*?)\s*```/g,
      /```\s*([\s\S]*?)\s*```/g,
      /(\{[\s\S]*\})/g,
    ];

    for (const pattern of patterns) {
      pattern.lastIndex = 0; // reset global regex
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(output)) !== null) {
        try {
          const data = JSON.parse(match[1]) as Record<string, unknown>;
          if ('findings' in data || 'summary' in data) {
            return modelResultFromDict(data);
          }
        } catch {
          // Not valid JSON — try next match
        }
      }
    }

    // Last resort: try parsing the whole output as JSON
    try {
      const data = JSON.parse(output) as Record<string, unknown>;
      return modelResultFromDict(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        model: this.name,
        summary: `Failed to parse output: ${msg}`,
        findings: [],
        inspected: [],
        questions: [],
        error: `Parse error: ${msg}\nRaw output:\n${output.slice(0, 1000)}`,
        raw_output: output,
      };
    }
  }

  /** Serialize a ModelResult to a plain object for JSON saving. */
  private _resultToDict(result: ModelResult): Record<string, unknown> {
    return {
      model: result.model,
      summary: result.summary,
      findings: result.findings,
      inspected: result.inspected,
      questions: result.questions,
      error: result.error ?? null,
    };
  }

  /** Run the model and return raw string output. Subclasses implement this. */
  abstract _runModel(prompt: string, timeout: number, nice: number): Promise<string>;
}

// ---------------------------------------------------------------------------
// Subprocess base
// ---------------------------------------------------------------------------

export abstract class SubprocessModel extends BaseModel {
  /**
   * Run model via subprocess.
   *
   * - Writes prompt to a temp file (for debugging / codex adapter)
   * - Builds command via _buildCommand()
   * - Applies env overrides (undefined value = delete key)
   * - Spawns with detached:true so we can kill the whole process group
   * - Passes prompt via stdin
   * - Detects auth/quota errors in stderr
   * - Kills process group on error or cancellation
   * - Cleans up temp file in finally
   */
  override async _runModel(prompt: string, timeout: number, nice: number): Promise<string> {
    // Write prompt to a temp file for debugging / codex
    const tmpPath = join(tmpdir(), `triage-${randomBytes(8).toString('hex')}.txt`);
    await writeFile(tmpPath, prompt, 'utf8');

    let proc: ReturnType<typeof spawn> | null = null;
    let stderrChunks: Buffer[] = [];

    try {
      const { cmd, env: envOverrides } = this._buildCommand(tmpPath);

      // Build clean environment: copy process.env then apply overrides
      const runEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) runEnv[k] = v;
      }
      for (const [k, v] of Object.entries(envOverrides)) {
        if (v === undefined) {
          delete runEnv[k];
        } else {
          runEnv[k] = v;
        }
      }

      // Prepend: nice -n <nice> timeout <timeout>
      const fullCmd = ['nice', '-n', String(nice), 'timeout', String(timeout), ...cmd];
      const [exe, ...args] = fullCmd;

      proc = spawn(exe, args, {
        env: runEnv,
        cwd: process.cwd(),
        detached: true,           // New process group — PGID == proc.pid
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      stderrChunks = [];

      proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      // Send prompt via stdin then close
      proc.stdin?.write(prompt, 'utf8');
      proc.stdin?.end();

      // Wait for exit
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        proc!.on('close', (code) => resolve(code));
        proc!.on('error', (err) => reject(err));
      });

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (exitCode !== 0) {
        // Check for auth errors first — gives a clearer message than a raw dump
        const authErr = detectAuthError(this.name, stderr);
        if (authErr) {
          throw new Error(authErr);
        }
        const errMsg = stderr || `Exit code ${exitCode}`;
        throw new Error(`Model failed: ${errMsg}`);
      }

      // Even on success, warn about auth hints buried in stderr
      if (stderr) {
        const authErr = detectAuthError(this.name, stderr);
        if (authErr) {
          throw new Error(authErr);
        }
      }

      return stdout;
    } catch (err: unknown) {
      // Kill the entire process group we spawned
      this._killProcessGroup(proc, 'SIGTERM');

      if (proc) {
        // Wait up to 3 s for graceful exit, then SIGKILL
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this._killProcessGroup(proc, 'SIGKILL');
            resolve();
          }, 3000);
          proc!.on('close', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }

      throw err;
    } finally {
      // Clean up temp file — best-effort
      try {
        await unlink(tmpPath);
      } catch {
        // Ignore — file may already be gone
      }

      // Final safety: reap zombie if still running
      if (proc && proc.exitCode === null) {
        this._killProcessGroup(proc, 'SIGKILL');
      }
    }
  }

  /**
   * Safely kill the process group that was created with detached:true.
   * Because detached:true guarantees PGID == proc.pid, we negate the PID.
   * Never targets PID <= 1 (init / our own group).
   */
  private _killProcessGroup(
    proc: ReturnType<typeof spawn> | null,
    signal: NodeJS.Signals,
  ): void {
    if (!proc || proc.exitCode !== null) return;
    const pgid = proc.pid;
    if (!pgid || pgid <= 1) return;
    try {
      process.kill(-pgid, signal);
    } catch {
      // Process group already gone — ignore
    }
  }

  /**
   * Build the command and env overrides for this model.
   *
   * @param promptFile  Path to temp file containing the prompt text.
   *                    Most adapters ignore this (they use stdin).
   *                    The Codex adapter reads it and passes the text as an arg.
   * @returns           `cmd` — argument list (no shell, no bash -c);
   *                    `env` — overrides (undefined value = delete from env)
   */
  abstract _buildCommand(promptFile: string): {
    cmd: string[];
    env: Record<string, string | undefined>;
  };
}
