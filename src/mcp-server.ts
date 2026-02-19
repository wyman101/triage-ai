/**
 * MCP (Model Context Protocol) server for triage-ai.
 *
 * Exposes triage functionality as the "triage" tool that any MCP-compatible
 * client (Claude Desktop, Claude Code, Cursor, Windsurf, Cline, etc.) can call.
 *
 * Transport: stdio (stdin/stdout) — standard for local MCP servers.
 *
 * Port of triage_cli/mcp_server.py:
 *   - McpServer high-level API from @modelcontextprotocol/sdk
 *   - StdioServerTransport for stdio transport
 *   - Zod schema validation on tool inputs
 *   - Per-request UUID-suffixed results directories for concurrent safety
 *   - Old results directories pruned to MAX_RESULTS_DIRS newest
 *   - Errors from individual models appended as Notes in the report
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { rmSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { RepoScanner } from './scanner.js';
import { MergeEngine, mergedResultToDict } from './merge.js';
import { BaseModel } from './models/base.js';
import type { ModelResult, MergedResult } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of per-run result directories to keep (oldest pruned). */
const MAX_RESULTS_DIRS = 20;

/** Base directory for intermediate results. */
const RESULTS_BASE = resolve(process.cwd(), 'triage_results');

// ---------------------------------------------------------------------------
// Tool input schema (Zod — required by McpServer.tool())
// ---------------------------------------------------------------------------

const TriageInputSchema = {
  prompt: z.string().describe(
    'What to analyze (e.g., "find security vulnerabilities in the authentication flow")',
  ),
  models: z
    .string()
    .optional()
    .default('claude,gemini,codex')
    .describe('Comma-separated models to use (default: claude,gemini,codex)'),
  diff_only: z
    .boolean()
    .optional()
    .default(false)
    .describe('Only analyze git diff instead of full files'),
  max_files: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(30)
    .describe('Maximum files to analyze (default: 30)'),
  format: z
    .enum(['md', 'json'])
    .optional()
    .default('md')
    .describe('Output format (default: md)'),
  timeout: z
    .number()
    .int()
    .min(30)
    .max(1800)
    .optional()
    .default(300)
    .describe('Timeout per model in seconds (default: 300)'),
  remember: z
    .boolean()
    .optional()
    .default(false)
    .describe('Save findings to AI memory files (CLAUDE.md, GEMINI.md, AGENTS.md)'),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a path exists.
 */
function pathExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a path is a directory.
 */
function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Prune old results directories, keeping only the newest MAX_RESULTS_DIRS.
 */
function pruneResultsDirs(): void {
  if (!pathExists(RESULTS_BASE)) return;

  let entries: Array<{ path: string; mtime: number }> = [];
  try {
    entries = readdirSync(RESULTS_BASE)
      .map((name) => {
        const full = join(RESULTS_BASE, name);
        try {
          return { path: full, mtime: statSync(full).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((e): e is { path: string; mtime: number } => e !== null && isDirectory(e.path))
      .sort((a, b) => b.mtime - a.mtime); // newest first
  } catch {
    return;
  }

  for (const entry of entries.slice(MAX_RESULTS_DIRS)) {
    try {
      rmSync(entry.path, { recursive: true, force: true });
    } catch {
      // Best-effort
    }
  }
}

/**
 * Dynamically import and instantiate a model class by name.
 * Returns null if the name is not recognised or the module is unavailable.
 */
async function loadModel(name: string): Promise<BaseModel | null> {
  const lower = name.trim().toLowerCase();
  try {
    if (lower === 'claude') {
      const { ClaudeModel } = await import('./models/claude.js');
      return new ClaudeModel();
    }
    if (lower === 'gemini') {
      const { GeminiModel } = await import('./models/gemini.js');
      return new GeminiModel();
    }
    if (lower === 'codex') {
      const { CodexModel } = await import('./models/codex.js');
      return new CodexModel();
    }
  } catch {
    // Module missing — treat as unavailable
  }
  return null;
}

/**
 * Generate a Markdown report from merged findings.
 */
function toMarkdown(
  merged: MergedResult,
  prompt: string,
  elapsedSec: number,
  modelNames: string[],
): string {
  const totalFindings =
    merged.blockers.length +
    merged.high.length +
    merged.medium.length +
    merged.low.length;

  const lines: string[] = [
    '# Triage Report',
    '',
    `**Prompt:** ${prompt}`,
    `**Models:** ${modelNames.join(', ')}`,
    `**Time:** ${elapsedSec.toFixed(1)}s`,
    `**Total findings:** ${totalFindings}` +
      (merged.consensus.length > 0 ? ` (${merged.consensus.length} consensus)` : ''),
    '',
  ];

  if (Object.keys(merged.summaries).length > 0) {
    lines.push('## Model Summaries', '');
    for (const [model, summary] of Object.entries(merged.summaries)) {
      lines.push(`**${model}:** ${summary}`, '');
    }
  }

  const sections: [string, typeof merged.blockers][] = [
    ['S0 — Blockers', merged.blockers],
    ['S1 — High', merged.high],
    ['S2 — Medium', merged.medium],
    ['S3 — Low', merged.low],
  ];

  for (const [heading, clusters] of sections) {
    if (clusters.length === 0) continue;
    lines.push(`## ${heading}`, '');
    for (const cluster of clusters) {
      const rep = cluster.findings[0];
      if (!rep) continue;
      const consensus = cluster.models.size >= 2 ? ' ⚡ consensus' : '';
      const models = [...cluster.models].join(', ');
      lines.push(
        `### ${rep.title}${consensus}`,
        '',
        `**Location:** \`${rep.location.path}:${rep.location.start_line}\`  ` +
          `**Category:** ${rep.category}  ` +
          `**Confidence:** ${rep.confidence}  ` +
          `**Models:** ${models}`,
        '',
        rep.evidence,
        '',
        `**Recommendation:** ${rep.recommendation}`,
        '',
      );
      if (rep.patch) {
        lines.push('```diff', rep.patch, '```', '');
      }
    }
  }

  if (merged.conflicts.length > 0) {
    lines.push('## Conflicts', '');
    for (const conflict of merged.conflicts) {
      lines.push(`- **${conflict.title}:** ${conflict.details}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Write triage findings into AI memory files (CLAUDE.md, GEMINI.md, AGENTS.md).
 */
function writeMemory(merged: MergedResult, prompt: string): void {
  const allFindings = [
    ...merged.blockers,
    ...merged.high,
    ...merged.medium,
    ...merged.low,
  ];
  if (allFindings.length === 0) return;

  const lines: string[] = [
    '<!-- triage-ai:start -->',
    `## Triage Findings (${new Date().toISOString().slice(0, 10)})`,
    '',
    `**Prompt:** ${prompt}`,
    '',
  ];

  for (const cluster of allFindings.slice(0, 20)) {
    const rep = cluster.findings[0];
    if (!rep) continue;
    const models = [...cluster.models].join(', ');
    lines.push(
      `- **[${rep.severity}]** ${rep.title} ` +
        `(\`${rep.location.path}:${rep.location.start_line}\`) — ${models}`,
    );
  }
  lines.push('<!-- triage-ai:end -->');
  const block = lines.join('\n') + '\n';

  for (const file of ['CLAUDE.md', 'GEMINI.md', 'AGENTS.md']) {
    const full = resolve(process.cwd(), file);
    if (!pathExists(full)) continue;
    try {
      const existing = readFileSync(full, 'utf8');
      const replaced = existing.replace(
        /<!-- triage-ai:start -->[\s\S]*?<!-- triage-ai:end -->\n?/g,
        block,
      );
      writeFileSync(full, replaced === existing ? existing + '\n' + block : replaced, 'utf8');
    } catch {
      // Best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// MCP server creation
// ---------------------------------------------------------------------------

function createServer(): McpServer {
  const server = new McpServer({
    name: 'triage-ai',
    version: '1.0.7',
  });

  // -------------------------------------------------------------------------
  // Tool: triage
  // -------------------------------------------------------------------------

  server.tool(
    'triage',
    'Run multi-model code triage using Claude, Gemini and Codex in parallel. ' +
      'Analyzes code for bugs, security issues, performance problems and more. ' +
      'Models run concurrently and findings are merged with consensus detection.',
    TriageInputSchema,
    async (args) => {
      const {
        prompt,
        models: modelsArg = 'claude,gemini,codex',
        diff_only = false,
        max_files = 30,
        format = 'md',
        timeout = 300,
        remember = false,
      } = args;

      if (!prompt?.trim()) {
        return {
          content: [{ type: 'text' as const, text: 'Error: No prompt provided' }],
          isError: true,
        };
      }

      // Create a per-request results directory with a UUID suffix to prevent
      // collisions under concurrent requests.
      const uid = randomBytes(4).toString('hex');
      const timestamp =
        new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19) +
        '_' +
        uid;
      const resultsDir = join(RESULTS_BASE, timestamp);
      mkdirSync(resultsDir, { recursive: true });

      // Prune old directories (best-effort)
      pruneResultsDirs();

      // Scan repository — scanner.scan() takes positional args
      const scanner = new RepoScanner();
      let context: ReturnType<RepoScanner['scan']>;
      try {
        context = scanner.scan(diff_only, Math.max(1, Math.min(200, max_files)), prompt);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error scanning repository: ${msg}` }],
          isError: true,
        };
      }

      // Instantiate model instances (BaseModel gives us the typed analyze() method)
      const modelNames = modelsArg.split(',').map((m) => m.trim()).filter(Boolean);

      const modelPairs = await Promise.all(
        modelNames.map(async (name) => ({ name, model: await loadModel(name) })),
      );

      const validPairs = modelPairs.filter(
        (p): p is { name: string; model: BaseModel } => p.model !== null,
      );

      if (validPairs.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: No valid models available. Install claude, gemini, or codex CLIs.',
            },
          ],
          isError: true,
        };
      }

      // Run all models in parallel using Promise.allSettled so one failure
      // does not cancel the others.  Cancellation propagates naturally via
      // the async task machinery if the MCP client closes the connection.
      const startTime = Date.now();

      const taskResults = await Promise.allSettled(
        validPairs.map(async ({ name, model }) => {
          try {
            const result = await model.analyze(prompt, context, resultsDir, timeout, 10);
            return { name, result, error: null as string | null };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { name, result: null as ModelResult | null, error: msg };
          }
        }),
      );

      const successResults: ModelResult[] = [];
      const errors: string[] = [];

      for (const outcome of taskResults) {
        if (outcome.status === 'rejected') {
          errors.push(`unknown: ${String(outcome.reason)}`);
          continue;
        }
        const { name, result, error } = outcome.value;
        if (result) {
          successResults.push(result);
        } else {
          errors.push(`${name}: ${error ?? 'no output'}`);
        }
      }

      const elapsedSec = (Date.now() - startTime) / 1000;

      if (successResults.length === 0) {
        const detail = errors.join('; ');
        return {
          content: [
            { type: 'text' as const, text: `Error: All models failed — ${detail}` },
          ],
          isError: true,
        };
      }

      // Merge findings
      const merger = new MergeEngine();
      const merged = merger.merge(successResults);

      // Generate report
      const activeNames = successResults.map((r) => r.model);
      let report: string;
      if (format === 'json') {
        report = JSON.stringify(
          {
            prompt,
            models: activeNames,
            elapsed_sec: elapsedSec,
            ...mergedResultToDict(merged),
          },
          null,
          2,
        );
      } else {
        report = toMarkdown(merged, prompt, elapsedSec, activeNames);
      }

      // Append failure notes so the caller knows which models were skipped
      if (errors.length > 0) {
        const noteLines = errors.map((e) => `- ${e}`).join('\n');
        report += `\n\n**Note: Some models failed:**\n${noteLines}\n`;
      }

      // Write memory if requested
      if (remember) {
        writeMemory(merged, prompt);
      }

      // Save merged.json for debugging / archival
      const mergedPath = join(resultsDir, 'merged.json');
      await writeFile(
        mergedPath,
        JSON.stringify(mergedResultToDict(merged), null, 2),
        'utf8',
      );

      return {
        content: [{ type: 'text' as const, text: report }],
      };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

/**
 * Create the MCP server, connect the stdio transport and start listening.
 *
 * Called from cli.ts when the --mcp flag is set.
 * Resolves when the transport closes (client disconnects).
 */
export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive until the transport closes
  await new Promise<void>((res) => {
    transport.onclose = () => res();
  });
}
