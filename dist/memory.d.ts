/**
 * Memory writer — saves triage findings to AI model memory files.
 *
 * After triage runs, findings are written to model-specific memory files
 * so that Claude, Gemini and Codex remember issues in future sessions.
 *
 * Supported memory files:
 * - CLAUDE.md     — Claude Code project instructions
 * - GEMINI.md     — Gemini CLI project context
 * - AGENTS.md     — Codex/OpenAI agent instructions
 */
import { type MergedResult, type FindingCluster } from './types.js';
export declare const MEMORY_START = "<!-- triage:start -->";
export declare const MEMORY_END = "<!-- triage:end -->";
export declare const MEMORY_FILES: Record<string, string>;
/**
 * Write triage findings to AI model memory files.
 *
 * Replaces any existing triage section (between markers) or appends
 * a new one. This keeps memory current — old findings are replaced by
 * the latest run, not accumulated forever.
 */
export declare function writeMemory(merged: MergedResult, prompt: string, root?: string, models?: string[]): Promise<Record<string, boolean>>;
/**
 * Remove triage sections from AI model memory files.
 */
export declare function clearMemory(root?: string, models?: string[]): Promise<Record<string, boolean>>;
/** Build the memory content block from merged results. */
export declare function _buildMemoryContent(merged: MergedResult, prompt: string): string;
/** Format a finding cluster for memory output. */
export declare function _formatCluster(cluster: FindingCluster): string[];
/**
 * Update a memory file with triage content.
 *
 * - If the file has an existing triage section, replace it.
 * - If the file exists without a triage section, append.
 * - If the file does not exist, create it with a minimal header.
 */
export declare function _updateMemoryFile(filepath: string, content: string): Promise<boolean>;
//# sourceMappingURL=memory.d.ts.map