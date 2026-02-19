/**
 * CLI detection and setup wizard for triage-ai.
 *
 * Detects available AI CLI tools (claude, gemini, codex), persists the
 * detected paths to ~/.config/triage-ai/config.json, and provides helpers
 * for validating model availability at runtime.
 */
import type { CliTool, TriageConfig } from './types.js';
/**
 * Detect all CLI tools.
 *
 * Respects TRIAGE_CLAUDE_CMD / TRIAGE_GEMINI_CMD / TRIAGE_CODEX_CMD env
 * overrides: if set, the env value is used as the command to locate via
 * `which` (or used directly if it is an absolute path).
 *
 * Returns a fresh copy of CLI_TOOLS with path/available filled in.
 */
export declare function detectClis(): Promise<CliTool[]>;
/**
 * Load the triage-ai config from ~/.config/triage-ai/config.json.
 * Returns null if the file does not exist or cannot be parsed.
 */
export declare function loadConfig(): Promise<TriageConfig | null>;
/**
 * Save the triage-ai config to ~/.config/triage-ai/config.json.
 * Creates the config directory if it does not exist.
 */
export declare function saveConfig(config: TriageConfig): Promise<void>;
/**
 * Full interactive setup: detect CLIs, print status, save config.
 *
 * Prints a status table to stdout showing which tools are available and
 * install instructions for missing ones. Persists results to config file.
 *
 * Returns the list of detected CliTool entries.
 */
export declare function runSetup(): Promise<CliTool[]>;
/**
 * Quick check from cached config: return the CliTool for modelName if available.
 *
 * Re-detects if the config is stale (>24 hours old) or does not exist.
 * Returns null if the model is not available.
 */
export declare function ensureCliAvailable(modelName: string): Promise<CliTool | null>;
/**
 * Filter a list of requested model names by availability.
 *
 * Warns to stderr about any requested models that are not available.
 * Returns only the available CliTool entries from the requested list.
 */
export declare function getAvailableModels(requestedModels: string[]): Promise<CliTool[]>;
//# sourceMappingURL=setup.d.ts.map