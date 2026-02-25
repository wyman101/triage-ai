/**
 * Base model interface and subprocess runner.
 *
 * Ported from triage_cli/models/base.py
 */
import { type ModelResult, type ScanContext } from '../types.js';
export declare abstract class BaseModel {
    name: string;
    cmdEnvVar: string;
    defaultCmd: string[];
    /** When true, models receive only pre-gathered context (no filesystem exploration). */
    contextOnly: boolean;
    constructor();
    /** Get the command to use for this model (env override > default). */
    get command(): string[];
    /**
     * Run analysis using this model.
     *
     * Builds prompt, saves it for debugging, calls _runModel, parses the
     * result, saves parsed JSON to resultsDir, returns ModelResult.
     */
    analyze(prompt: string, context: ScanContext, resultsDir: string, timeout?: number, nice?: number): Promise<ModelResult>;
    /** Build the full prompt string from the template and scan context. */
    buildPrompt(prompt: string, context: ScanContext): string;
    /**
     * Parse raw model output into a ModelResult.
     *
     * Tries in order:
     *   1. JSON inside ```json ... ``` blocks
     *   2. JSON inside ``` ... ``` blocks
     *   3. Raw JSON parse of entire output (trimmed)
     *   4. First `{...}` match in the string (greedy from first { to last })
     *   5. Fallback: treat raw text as a summary with 0 findings
     */
    parseOutput(output: string): ModelResult;
    /** Serialize a ModelResult to a plain object for JSON saving. */
    private _resultToDict;
    /** Run the model and return raw string output. Subclasses implement this. */
    abstract _runModel(prompt: string, timeout: number, nice: number): Promise<string>;
}
export declare abstract class SubprocessModel extends BaseModel {
    /**
     * Run model via subprocess.
     *
     * - Writes prompt to a temp file (always — used for large-arg fallback and debugging)
     * - Builds command via _buildCommand()
     * - Guards against oversized CLI args (auto-replaces with temp file path)
     * - Applies env overrides (undefined value = delete key)
     * - Spawns with detached:true so we can kill the whole process group
     * - Passes prompt via stdin
     * - Detects auth/quota errors in stderr
     * - Kills process group on error or cancellation
     * - Cleans up temp file in finally
     */
    _runModel(prompt: string, timeout: number, nice: number): Promise<string>;
    /**
     * Safely kill the process group that was created with detached:true.
     * Because detached:true guarantees PGID == proc.pid, we negate the PID.
     * Never targets PID <= 1 (init / our own group).
     */
    private _killProcessGroup;
    /**
     * Build the command and env overrides for this model.
     *
     * IMPORTANT: Never put the prompt text itself into a CLI argument.
     * Use stdin (the base class pipes the prompt automatically) or
     * reference the temp file via `promptFile`.  Any individual argument
     * exceeding 128 KB is automatically replaced with the temp file path
     * as a safety net.
     *
     * @param promptFile  Path to temp file containing the prompt text.
     *                    Use this if the CLI supports reading from a file.
     * @returns           `cmd` — argument list (no shell, no bash -c);
     *                    `env` — overrides (undefined value = delete from env)
     */
    abstract _buildCommand(promptFile: string): {
        cmd: string[];
        env: Record<string, string | undefined>;
    };
}
//# sourceMappingURL=base.d.ts.map