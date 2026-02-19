/**
 * CLI detection and setup wizard for triage-ai.
 *
 * Detects available AI CLI tools (claude, gemini, codex), persists the
 * detected paths to ~/.config/triage-ai/config.json, and provides helpers
 * for validating model availability at runtime.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import which from 'which';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CONFIG_DIR = join(homedir(), '.config', 'triage-ai');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
/** Config stale threshold: 24 hours in milliseconds. */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const CLI_TOOLS = [
    {
        name: 'claude',
        command: 'claude',
        path: null,
        available: false,
        install_cmd: 'npm install -g @anthropic-ai/claude-code',
        install_url: 'https://docs.anthropic.com/en/docs/claude-code',
    },
    {
        name: 'gemini',
        command: 'gemini',
        path: null,
        available: false,
        install_cmd: 'npm install -g @google/gemini-cli',
        install_url: 'https://github.com/google-gemini/gemini-cli',
    },
    {
        name: 'codex',
        command: 'codex',
        path: null,
        available: false,
        install_cmd: 'npm install -g @openai/codex',
        install_url: 'https://github.com/openai/codex',
    },
];
// ---------------------------------------------------------------------------
// Env override map: model name → env variable that can override the command
// ---------------------------------------------------------------------------
const ENV_OVERRIDES = {
    claude: 'TRIAGE_CLAUDE_CMD',
    gemini: 'TRIAGE_GEMINI_CMD',
    codex: 'TRIAGE_CODEX_CMD',
};
// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------
/**
 * Detect all CLI tools.
 *
 * Respects TRIAGE_CLAUDE_CMD / TRIAGE_GEMINI_CMD / TRIAGE_CODEX_CMD env
 * overrides: if set, the env value is used as the command to locate via
 * `which` (or used directly if it is an absolute path).
 *
 * Returns a fresh copy of CLI_TOOLS with path/available filled in.
 */
export async function detectClis() {
    const results = [];
    for (const tool of CLI_TOOLS) {
        const envKey = ENV_OVERRIDES[tool.name];
        const envOverride = envKey ? process.env[envKey] : undefined;
        // Effective command to search for
        const cmd = envOverride ?? tool.command;
        let resolvedPath = null;
        try {
            if (cmd.startsWith('/') || cmd.startsWith('./')) {
                // Absolute or relative path provided — just check existence
                resolvedPath = existsSync(cmd) ? cmd : null;
            }
            else {
                resolvedPath = await which(cmd);
            }
        }
        catch {
            resolvedPath = null;
        }
        results.push({
            ...tool,
            command: cmd,
            path: resolvedPath,
            available: resolvedPath !== null,
        });
    }
    return results;
}
/**
 * Load the triage-ai config from ~/.config/triage-ai/config.json.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function loadConfig() {
    try {
        const raw = await readFile(CONFIG_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' &&
            parsed !== null &&
            'cli_paths' in parsed &&
            'last_detected' in parsed) {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Save the triage-ai config to ~/.config/triage-ai/config.json.
 * Creates the config directory if it does not exist.
 */
export async function saveConfig(config) {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8');
}
/**
 * Full interactive setup: detect CLIs, print status, save config.
 *
 * Prints a status table to stdout showing which tools are available and
 * install instructions for missing ones. Persists results to config file.
 *
 * Returns the list of detected CliTool entries.
 */
export async function runSetup() {
    console.log('\ntriage-ai — CLI tool detection\n');
    console.log('Scanning for AI CLI tools...\n');
    const tools = await detectClis();
    // Print status table
    const rows = [];
    for (const tool of tools) {
        if (tool.available) {
            rows.push({
                name: tool.name,
                status: 'FOUND',
                detail: tool.path ?? tool.command,
            });
        }
        else {
            rows.push({
                name: tool.name,
                status: 'NOT FOUND',
                detail: `Install: ${tool.install_cmd}`,
            });
        }
    }
    const nameWidth = Math.max(4, ...rows.map((r) => r.name.length));
    const statusWidth = 9; // "NOT FOUND"
    console.log(`${'Tool'.padEnd(nameWidth)}  ${'Status'.padEnd(statusWidth)}  Detail`);
    console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(statusWidth)}  ${'-'.repeat(40)}`);
    for (const row of rows) {
        console.log(`${row.name.padEnd(nameWidth)}  ${row.status.padEnd(statusWidth)}  ${row.detail}`);
    }
    const available = tools.filter((t) => t.available);
    const missing = tools.filter((t) => !t.available);
    console.log(`\n${available.length}/${tools.length} tools available.`);
    if (missing.length > 0) {
        console.log('\nTo install missing tools:');
        for (const tool of missing) {
            console.log(`  ${tool.install_cmd}`);
            console.log(`  Docs: ${tool.install_url}`);
        }
    }
    // Build and save config
    const cliPaths = {};
    for (const tool of tools) {
        if (tool.available && tool.path) {
            cliPaths[tool.name] = tool.path;
        }
    }
    const config = {
        cli_paths: cliPaths,
        last_detected: new Date().toISOString(),
    };
    await saveConfig(config);
    console.log(`\nConfig saved to ${CONFIG_FILE}\n`);
    return tools;
}
/**
 * Quick check from cached config: return the CliTool for modelName if available.
 *
 * Re-detects if the config is stale (>24 hours old) or does not exist.
 * Returns null if the model is not available.
 */
export async function ensureCliAvailable(modelName) {
    // Try cached config first
    const config = await loadConfig();
    const now = Date.now();
    if (config) {
        const lastDetected = new Date(config.last_detected).getTime();
        const isStale = now - lastDetected > STALE_THRESHOLD_MS;
        if (!isStale) {
            // Use cached data
            const baseTool = CLI_TOOLS.find((t) => t.name === modelName);
            if (!baseTool)
                return null;
            const path = config.cli_paths[modelName] ?? null;
            return {
                ...baseTool,
                path,
                available: path !== null,
            };
        }
    }
    // Cache is stale or missing — re-detect
    const tools = await detectClis();
    // Persist fresh results
    const cliPaths = {};
    for (const tool of tools) {
        if (tool.available && tool.path) {
            cliPaths[tool.name] = tool.path;
        }
    }
    await saveConfig({
        cli_paths: cliPaths,
        last_detected: new Date().toISOString(),
    });
    return tools.find((t) => t.name === modelName && t.available) ?? null;
}
/**
 * Filter a list of requested model names by availability.
 *
 * Warns to stderr about any requested models that are not available.
 * Returns only the available CliTool entries from the requested list.
 */
export async function getAvailableModels(requestedModels) {
    const allTools = await detectClis();
    const toolMap = new Map(allTools.map((t) => [t.name, t]));
    const available = [];
    for (const name of requestedModels) {
        const tool = toolMap.get(name);
        if (!tool) {
            process.stderr.write(`triage-ai: warning: unknown model "${name}" — valid options are: ${CLI_TOOLS.map((t) => t.name).join(', ')}\n`);
            continue;
        }
        if (!tool.available) {
            process.stderr.write(`triage-ai: warning: "${name}" is not installed or not found in PATH.\n` +
                `  Install with: ${tool.install_cmd}\n` +
                `  Docs: ${tool.install_url}\n`);
            continue;
        }
        available.push(tool);
    }
    return available;
}
//# sourceMappingURL=setup.js.map