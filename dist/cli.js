#!/usr/bin/env node
/**
 * triage-ai CLI entry point.
 *
 * Parses arguments, runs the full triage pipeline and renders progress
 * via TriageProgress.  Supports both interactive (TTY) and CI/piped modes.
 */
import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import which from 'which';
import { TriageProgress, plainTeamLine, plainReportLine } from './progress.js';
import { RepoScanner } from './scanner.js';
import { MergeEngine, mergedResultToDict } from './merge.js';
import { detectAuthError } from './types.js';
import { startMcpServer } from './mcp-server.js';
import { spawnSync } from 'node:child_process';
// ---------------------------------------------------------------------------
// Version — read from package.json so it stays in sync automatically
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const VERSION = _require('../package.json').version;
// ---------------------------------------------------------------------------
// Config path
// ---------------------------------------------------------------------------
const CONFIG_DIR = join(homedir(), '.config', 'triage-ai');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
// Auth helpers — use shared implementation from types.ts
// detectAuthError and authHint are imported above
// ---------------------------------------------------------------------------
// CLI tool detection
// ---------------------------------------------------------------------------
const KNOWN_TOOLS = [
    {
        name: 'Claude',
        command: 'claude',
        install_cmd: 'npm install -g @anthropic-ai/claude-code',
        install_url: 'https://claude.ai/code',
    },
    {
        name: 'Gemini',
        command: 'gemini',
        install_cmd: 'npm install -g @google/gemini-cli',
        install_url: 'https://github.com/google-gemini/gemini-cli',
    },
    {
        name: 'Codex',
        command: 'codex',
        install_cmd: 'npm install -g @openai/codex',
        install_url: 'https://github.com/openai/codex',
    },
];
async function detectTools(requested) {
    const names = new Set(requested.map((n) => n.trim().toLowerCase()));
    const tools = [];
    for (const known of KNOWN_TOOLS) {
        if (!names.has(known.command.toLowerCase()))
            continue;
        let foundPath = null;
        try {
            foundPath = await which(known.command);
        }
        catch {
            // not found on PATH
        }
        tools.push({
            ...known,
            path: foundPath,
            available: foundPath !== null,
        });
    }
    return tools;
}
// ---------------------------------------------------------------------------
// Version detection for CLI tools
// ---------------------------------------------------------------------------
/**
 * Get the version string of an installed CLI tool.
 * Returns null if the version cannot be determined.
 */
function getCliVersion(command) {
    try {
        const result = spawnSync(command, ['--version'], {
            timeout: 5000,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const output = (result.stdout ?? '') + (result.stderr ?? '');
        const match = output.match(/(\d+\.\d+\.\d+)/);
        return match ? match[1] : null;
    }
    catch {
        return null;
    }
}
/**
 * Check if triage-ai itself has an update available on npm.
 * Returns the latest version string or null if check fails.
 */
async function checkForUpdates() {
    try {
        const result = spawnSync('npm', ['view', 'triage-ai', 'version'], {
            timeout: 5000,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const latest = result.stdout?.trim();
        if (latest && latest !== VERSION)
            return latest;
    }
    catch { /* offline or registry unavailable */ }
    return null;
}
/**
 * Classify a failure error message into a FailureKind.
 */
function classifyFailure(errorMsg) {
    const lower = errorMsg.toLowerCase();
    if (detectAuthError('_', errorMsg)) {
        if (/rate.?limit|too many|429|quota/.test(lower))
            return 'rate_limit';
        return 'auth';
    }
    if (/timeout|timed out|exit code (124|137)/.test(lower))
        return 'timeout';
    if (/plain text instead of json/i.test(lower))
        return 'parse';
    return 'unknown';
}
// ---------------------------------------------------------------------------
// Model runner — dynamically imports model classes to avoid circular deps.
// All model classes extend BaseModel which has a concrete analyze() typed to
// ScanContext, so we use BaseModel as the shared interface.
// ---------------------------------------------------------------------------
async function loadModel(modelName) {
    const lower = modelName.toLowerCase().trim();
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
    throw new Error(`Unknown model: ${modelName}`);
}
// ---------------------------------------------------------------------------
// Config / memory helpers
// ---------------------------------------------------------------------------
function configExists() {
    return existsSync(CONFIG_FILE);
}
function readConfig() {
    if (!existsSync(CONFIG_FILE))
        return {};
    try {
        return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    }
    catch {
        return {};
    }
}
function writeConfig(data) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function clearMemory() {
    const memFiles = ['CLAUDE.md', 'GEMINI.md', 'AGENTS.md'];
    let cleared = 0;
    for (const file of memFiles) {
        const full = resolve(process.cwd(), file);
        if (!existsSync(full))
            continue;
        const content = readFileSync(full, 'utf8');
        const cleaned = content.replace(/<!-- triage-ai:start -->[\s\S]*?<!-- triage-ai:end -->\n?/g, '');
        if (cleaned !== content) {
            writeFileSync(full, cleaned, 'utf8');
            cleared++;
        }
    }
    console.log(`Cleared triage findings from ${cleared} memory file(s).`);
}
function writeMemory(merged, prompt) {
    const allFindings = [
        ...merged.blockers,
        ...merged.high,
        ...merged.medium,
        ...merged.low,
    ];
    if (allFindings.length === 0)
        return;
    const lines = [
        '<!-- triage-ai:start -->',
        `## Triage Findings (${new Date().toISOString().slice(0, 10)})`,
        '',
        `**Prompt:** ${prompt}`,
        '',
        `**Summary:** ${allFindings.length} findings` +
            (merged.consensus.length > 0
                ? `, ${merged.consensus.length} consensus`
                : ''),
        '',
    ];
    for (const cluster of allFindings.slice(0, 20)) {
        const rep = cluster.findings[0];
        const models = [...cluster.models].join(', ');
        lines.push(`- **[${rep?.severity ?? 'S3'}]** ${rep?.title ?? 'Unknown'} ` +
            `(\`${rep?.location?.path ?? 'unknown'}:${rep?.location?.start_line ?? 0}\`) — ${models}`);
    }
    lines.push('<!-- triage-ai:end -->');
    const block = lines.join('\n') + '\n';
    const memFiles = ['CLAUDE.md', 'GEMINI.md', 'AGENTS.md'];
    let written = 0;
    for (const file of memFiles) {
        const full = resolve(process.cwd(), file);
        if (existsSync(full)) {
            const existing = readFileSync(full, 'utf8');
            const replaced = existing.replace(/<!-- triage-ai:start -->[\s\S]*?<!-- triage-ai:end -->\n?/g, block);
            writeFileSync(full, replaced === existing ? existing + '\n' + block : replaced, 'utf8');
        }
        else {
            // Create new memory file
            writeFileSync(full, block, 'utf8');
        }
        written++;
    }
    console.log(`Saved ${Math.min(allFindings.length, 20)} findings to ${written} AI memory files.`);
}
// ---------------------------------------------------------------------------
// Ready check — quick smoke test for all models
// ---------------------------------------------------------------------------
async function runReady(modelFilter) {
    const chalk = (await import('chalk')).default;
    const requestedModels = modelFilter
        ? modelFilter.split(',').map((m) => m.trim().toLowerCase()).filter(Boolean)
        : ['claude', 'gemini', 'codex'];
    console.log(`\ntriage-ai v${VERSION} — ready check\n`);
    // Check for triage-ai updates
    const latestVersion = await checkForUpdates();
    if (latestVersion) {
        console.log(chalk.yellow(`  ⬆ Update available: ${VERSION} → ${latestVersion}`) +
            chalk.dim(` (npm update -g triage-ai)\n`));
    }
    // 1. Detect CLIs with version info
    const tools = await detectTools(requestedModels);
    const available = [];
    for (const t of tools) {
        if (t.available) {
            const ver = getCliVersion(t.command);
            const verStr = ver ? chalk.dim(` v${ver}`) : '';
            console.log(chalk.green(`  ✓ ${t.name}`) + verStr + ` found at ${t.path}`);
            available.push(t);
        }
        else {
            console.log(chalk.red(`  ✗ ${t.name}`) + ` not installed — ${t.install_cmd}`);
        }
    }
    if (available.length === 0) {
        console.log(chalk.red('\nNo AI CLIs found. Install at least one and retry.'));
        process.exit(1);
    }
    // 2. Minimal context — no repo scanning
    const emptyContext = {
        is_git_repo: false,
        has_diff: false,
        git_diff: '',
        git_status: '',
        git_log: '',
        tree: '',
        files: [],
        prompt: 'Say hello in one sentence.',
        root: process.cwd(),
    };
    // 3. Run each model in parallel with a short timeout
    console.log('\nTesting models…\n');
    const tmpResults = join(tmpdir(), `triage-ready-${Date.now()}`);
    mkdirSync(tmpResults, { recursive: true });
    const tests = available.map(async (tool) => {
        const t0 = Date.now();
        try {
            const model = await loadModel(tool.command);
            model.contextOnly = true;
            const result = await model.analyze('Say hello in one sentence.', emptyContext, tmpResults, 30, 10);
            const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
            if (result.error) {
                // Model returned an error result (auth, timeout, etc.)
                const authMsg = detectAuthError(tool.name, result.error);
                return { name: tool.name, ok: false, elapsed, error: authMsg ?? result.error.slice(0, 120) };
            }
            const snippet = (result.summary || result.raw_output || '').replace(/\n/g, ' ').slice(0, 80);
            return { name: tool.name, ok: true, elapsed, snippet };
        }
        catch (err) {
            const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
            const msg = err instanceof Error ? err.message : String(err);
            const authMsg = detectAuthError(tool.name, msg);
            return { name: tool.name, ok: false, elapsed, error: authMsg ?? msg.slice(0, 120) };
        }
    });
    const results = await Promise.all(tests);
    // 4. Report
    let passed = 0;
    for (const r of results) {
        if (r.ok) {
            console.log(chalk.green(`  ✓ ${r.name}`) + ` responded in ${r.elapsed}s` +
                ('snippet' in r ? chalk.gray(` — "${r.snippet}"`) : ''));
            passed++;
        }
        else {
            console.log(chalk.red(`  ✗ ${r.name}`) + ` failed (${r.elapsed}s)` +
                ('error' in r ? chalk.gray(` — ${r.error}`) : ''));
        }
    }
    // Clean up temp dir
    try {
        const { rm } = await import('node:fs/promises');
        await rm(tmpResults, { recursive: true, force: true });
    }
    catch { /* best effort */ }
    console.log('');
    if (passed === results.length) {
        console.log(chalk.green(`All ${passed} model${passed === 1 ? '' : 's'} ready.`));
    }
    else if (passed > 0) {
        console.log(chalk.yellow(`${passed}/${results.length} models ready.`) +
            ' Fix failing models or use --models to select working ones.');
    }
    else {
        console.log(chalk.red('No models responding.') + ' Check authentication — run each CLI interactively first.');
        process.exit(1);
    }
}
// ---------------------------------------------------------------------------
// Setup wizard
// ---------------------------------------------------------------------------
async function runSetup() {
    console.log('\ntriage-ai setup\n');
    console.log('Checking for AI CLI tools...\n');
    let tools = await detectTools(['claude', 'gemini', 'codex']);
    for (const t of tools) {
        const status = t.available
            ? `  ✓ ${t.name} found at ${t.path}`
            : `  ✗ ${t.name} not installed`;
        console.log(status);
    }
    let missing = tools.filter((t) => !t.available);
    // Offer to install missing CLIs (TTY only)
    if (missing.length > 0 && process.stdin.isTTY) {
        const { createInterface } = await import('node:readline');
        const { execSync } = await import('node:child_process');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q) => new Promise((res) => rl.question(q, res));
        console.log('');
        for (const tool of missing) {
            const answer = await ask(`Install ${tool.name}? (${tool.install_cmd}) [Y/n] `);
            if (answer.trim().toLowerCase() !== 'n') {
                console.log(`\nInstalling ${tool.name}...`);
                try {
                    execSync(tool.install_cmd, { stdio: 'inherit', timeout: 120_000 });
                    console.log(`  ✓ ${tool.name} installed\n`);
                }
                catch {
                    console.log(`  ✗ ${tool.name} install failed — run manually: ${tool.install_cmd}\n`);
                }
            }
        }
        rl.close();
        // Re-detect after installs
        tools = await detectTools(['claude', 'gemini', 'codex']);
        missing = tools.filter((t) => !t.available);
    }
    else if (missing.length > 0) {
        // Non-TTY: just show install commands
        console.log('\nTo install missing tools:');
        for (const tool of missing) {
            console.log(`  ${tool.install_cmd}`);
        }
    }
    const available = tools.filter((t) => t.available);
    if (available.length === 0) {
        console.log('\nNo AI CLI tools found. Install at least one and re-run: triage-ai setup');
        return;
    }
    // Auth reminder
    console.log('\nRemember to sign in to each CLI before using triage-ai:');
    for (const tool of available) {
        const name = tool.command.toLowerCase();
        if (name === 'claude')
            console.log('  Claude:  claude  (follow the login prompts)');
        if (name === 'gemini')
            console.log('  Gemini:  gemini  (follow the login prompts)');
        if (name === 'codex')
            console.log('  Codex:   codex   (follow the login prompts, or set OPENAI_API_KEY)');
    }
    const config = {
        models: available.map((t) => t.command).join(','),
        last_setup: new Date().toISOString(),
        cli_paths: Object.fromEntries(available.filter((t) => t.path).map((t) => [t.command, t.path])),
    };
    writeConfig(config);
    console.log(`\nConfig saved. Run: triage-ai "your analysis prompt"`);
}
// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------
function generateMarkdownReport(merged, prompt, elapsedSec, modelNames) {
    const totalFindings = merged.blockers.length +
        merged.high.length +
        merged.medium.length +
        merged.low.length;
    const lines = [
        '# Triage Report',
        '',
        `**Prompt:** ${prompt}`,
        `**Models:** ${modelNames.join(', ')}`,
        `**Time:** ${elapsedSec.toFixed(1)}s`,
        `**Total findings:** ${totalFindings} (${merged.consensus.length} consensus)`,
        '',
    ];
    if (Object.keys(merged.summaries).length > 0) {
        lines.push('## Model Summaries', '');
        for (const [model, summary] of Object.entries(merged.summaries)) {
            lines.push(`**${model}:** ${summary}`, '');
        }
    }
    const sections = [
        ['S0 — Blockers', merged.blockers],
        ['S1 — High', merged.high],
        ['S2 — Medium', merged.medium],
        ['S3 — Low', merged.low],
    ];
    for (const [heading, clusters] of sections) {
        if (clusters.length === 0)
            continue;
        lines.push(`## ${heading}`, '');
        for (const cluster of clusters) {
            const rep = cluster.findings[0];
            if (!rep)
                continue;
            const consensus = cluster.models.size >= 2 ? ' ⚡ consensus' : '';
            const models = [...cluster.models].join(', ');
            lines.push(`### ${rep.title}${consensus}`, '', `**Location:** \`${rep.location.path}:${rep.location.start_line}\`  ` +
                `**Category:** ${rep.category}  ` +
                `**Confidence:** ${rep.confidence}  ` +
                `**Models:** ${models}`, '', rep.evidence, '', `**Recommendation:** ${rep.recommendation}`, '');
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
function generateJsonReport(merged, prompt, elapsedSec, modelNames) {
    return JSON.stringify({
        prompt,
        models: modelNames,
        elapsed_sec: elapsedSec,
        ...mergedResultToDict(merged),
    }, null, 2);
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const program = new Command();
    program
        .name('triage-ai')
        .version(VERSION)
        .description('Multi-model code triage — run Claude, Gemini and Codex in parallel')
        .argument('[prompt]', 'Analysis prompt / question for the models')
        .option('--models <list>', 'Comma-separated models to use', 'claude,gemini,codex')
        .option('--diff-only', 'Send only git diff instead of full files', false)
        .option('--max-files <n>', 'Maximum files to include in initial context (agents explore beyond this)', '200')
        .option('--format <fmt>', 'Output format: md or json', 'md')
        .option('--out <file>', 'Write report to file instead of stdout')
        .option('--apply', 'Apply best-effort safe patches (creates git branch)', false)
        .option('--dry-run', 'Show patches but do not apply them', false)
        .option('--timeout <sec>', 'Timeout per model in seconds', '300')
        .option('--nice <n>', 'Nice level for subprocess priority', '10')
        .option('--results-dir <dir>', 'Directory for intermediate results', './triage_results')
        .option('--remember', 'Save findings to AI memory files (CLAUDE.md, GEMINI.md, AGENTS.md)', false)
        .option('--forget', 'Remove triage findings from AI memory files and exit', false)
        .option('--context-only', 'Restrict models to pre-gathered context only (faster, no filesystem exploration)', false)
        .option('-v, --verbose', 'Verbose output', false)
        .option('--mcp', 'Start MCP server instead of running triage', false);
    // Sub-commands — handle before parse so we can await them
    if (process.argv[2] === 'setup') {
        await runSetup();
        process.exit(0);
    }
    if (process.argv[2] === 'ready') {
        await runReady(process.argv[3]); // optional: model filter e.g. "claude,gemini"
        process.exit(0);
    }
    program.parse(process.argv);
    const opts = program.opts();
    // --mcp: start MCP server and exit
    if (opts.mcp) {
        await startMcpServer();
        return;
    }
    // --forget: clear memory and exit
    if (opts.forget) {
        clearMemory();
        process.exit(0);
    }
    // Coerce numeric options
    const maxFiles = Math.max(1, parseInt(opts.maxFiles, 10) || 30);
    const timeout = Math.max(30, parseInt(opts.timeout, 10) || 300);
    const nice = parseInt(opts.nice, 10) || 10;
    const format = opts.format === 'json' ? 'json' : 'md';
    const promptArg = program.args[0];
    // First-run detection
    if (!configExists()) {
        console.log('triage-ai: first run detected — running setup wizard\n');
        await runSetup();
        if (!promptArg)
            process.exit(0);
    }
    if (!promptArg) {
        console.error('Error: No prompt provided');
        console.error('Usage: triage-ai "<your analysis prompt>"');
        console.error('       triage-ai setup');
        process.exit(1);
    }
    const prompt = promptArg;
    // -------------------------------------------------------------------------
    // Progress display
    // -------------------------------------------------------------------------
    const progress = new TriageProgress();
    progress.printHeader();
    // -------------------------------------------------------------------------
    // Phase 1: Intake
    // -------------------------------------------------------------------------
    progress.startPhase('intake', 'Intake');
    const scanner = new RepoScanner();
    progress.startSpinner('Scanning repository', 'discovering files…');
    let context;
    try {
        // scanner.scan() takes positional args: (diffOnly, maxFiles, prompt)
        context = scanner.scan(opts.diffOnly, maxFiles, prompt);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        progress.stopSpinner('Scanning repository', 'failed', msg);
        console.error(`Fatal: scanner failed — ${msg}`);
        process.exit(1);
    }
    const fileCount = context.files.length;
    const totalBytes = context.files.reduce((acc, f) => acc + Buffer.byteLength(f.content, 'utf8'), 0);
    const kbStr = (totalBytes / 1024).toFixed(0) + ' KB';
    const diffNote = context.has_diff ? ', diff mode' : '';
    progress.stopSpinner('Scanning repository', 'done', `${fileCount} files${diffNote}`);
    if (fileCount === 0) {
        progress.addItem('Warning');
        progress.updateItem('Warning', 'skipped', 'no source files found — models will use git/tree context only');
    }
    // Secret redaction count if the scanner exposes it
    const redactedCount = context.redacted_count ?? 0;
    if (redactedCount > 0) {
        progress.addItem('Redacted secrets');
        progress.updateItem('Redacted secrets', 'done', `${redactedCount} patterns masked`);
    }
    progress.addItem('Built context package');
    progress.updateItem('Built context package', 'done', `${kbStr} across ${fileCount} files`);
    // -------------------------------------------------------------------------
    // Phase 2: Triage Team
    // -------------------------------------------------------------------------
    progress.startPhase('team', 'Triage Team');
    const modelNames = opts.models.split(',').map((m) => m.trim()).filter(Boolean);
    const tools = await detectTools(modelNames);
    const cliVersions = {};
    for (const tool of tools) {
        progress.addItem(tool.name);
        if (tool.available) {
            const ver = getCliVersion(tool.command);
            cliVersions[tool.command] = ver;
            const verStr = ver ? ` v${ver}` : '';
            progress.updateItem(tool.name, 'done', `found at ${tool.path ?? tool.command}${verStr}`);
        }
        else {
            progress.updateItem(tool.name, 'skipped', 'not installed (skipping)');
        }
    }
    const availableTools = tools.filter((t) => t.available);
    if (!process.stdout.isTTY) {
        process.stdout.write(plainTeamLine(tools.map((t) => ({ name: t.name, available: t.available }))) + '\n');
    }
    if (availableTools.length === 0) {
        console.error('\nError: No AI CLI tools available.\n');
        console.error('Install at least one of the following:\n');
        for (const tool of tools) {
            console.error(`  ${tool.name}:  ${tool.install_cmd}`);
            console.error(`    ${tool.install_url}`);
        }
        process.exit(1);
    }
    // -------------------------------------------------------------------------
    // Phase 3: Assessment
    // -------------------------------------------------------------------------
    progress.startPhase('assessment', 'Assessment');
    // Create results directory with timestamp
    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
    const resultsDir = resolve(opts.resultsDir, timestamp);
    mkdirSync(resultsDir, { recursive: true });
    if (opts.verbose) {
        process.stdout.write(`[verbose] Results directory: ${resultsDir}\n`);
    }
    const startTime = Date.now();
    // Start a spinner per available model (with timeout for elapsed display)
    for (const tool of availableTools) {
        progress.startSpinner(tool.name, 'examining codebase…', timeout);
    }
    // Run all models in parallel; Promise.allSettled so one failure doesn't
    // cancel the others.
    const modelRuns = availableTools.map(async (tool) => {
        const modelStart = Date.now();
        try {
            const model = await loadModel(tool.command);
            model.contextOnly = opts.contextOnly;
            const result = await model.analyze(prompt, context, resultsDir, timeout, nice);
            const elapsedMs = Date.now() - modelStart;
            const elapsed = (elapsedMs / 1000).toFixed(1) + 's';
            // Enrich result with structured metadata
            result.version = cliVersions[tool.command] ?? null;
            result.elapsed_ms = elapsedMs;
            result.context_truncated = model.lastBuildTruncated;
            // Detect parse-only failures (model responded but couldn't produce JSON)
            if (result.findings.length === 0 && result.error?.includes('plain text')) {
                result.status = 'succeeded';
                result.parsed_as = 'plain_text';
                progress.stopSpinner(tool.name, 'done', `0 findings — prose response, not JSON (${elapsed})`);
            }
            else if (result.error) {
                result.status = 'failed';
                result.failure_kind = classifyFailure(result.error);
                result.needs_auth = result.failure_kind === 'auth';
                const hint = detectAuthError(tool.name, result.error);
                progress.stopSpinner(tool.name, 'failed', hint ?? result.error.slice(0, 100));
            }
            else {
                result.status = 'succeeded';
                result.parsed_as = 'json';
                progress.stopSpinner(tool.name, 'done', `${result.findings.length} findings (${elapsed})`);
            }
            return { tool, result, error: null };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const hint = detectAuthError(tool.name, msg);
            progress.stopSpinner(tool.name, 'failed', hint ?? msg.slice(0, 100));
            return { tool, result: null, error: msg };
        }
    });
    const settled = await Promise.allSettled(modelRuns);
    const successResults = [];
    const failedModels = [];
    for (const outcome of settled) {
        if (outcome.status === 'rejected') {
            failedModels.push({ name: 'unknown', error: String(outcome.reason) });
            continue;
        }
        const { tool, result, error } = outcome.value;
        if (result && !result.needs_auth) {
            successResults.push(result);
        }
        else if (result?.needs_auth) {
            failedModels.push({ name: tool.name, error: result.error ?? 'auth required' });
        }
        else {
            failedModels.push({ name: tool.name, error: error ?? 'unknown error' });
        }
    }
    // Warn about context truncation
    const truncatedModels = successResults.filter((r) => r.context_truncated);
    if (truncatedModels.length > 0) {
        progress.addItem('Context truncation');
        progress.updateItem('Context truncation', 'skipped', 'some files/diffs were truncated — analysis may be incomplete');
    }
    if (successResults.length === 0) {
        console.error('\nError: All models failed.\n');
        for (const fm of failedModels) {
            const authMsg = detectAuthError(fm.name, fm.error);
            console.error(`  ${fm.name}: ${authMsg ?? fm.error.slice(0, 200)}`);
        }
        process.exit(1);
    }
    // -------------------------------------------------------------------------
    // Phase 4: Diagnosis
    // -------------------------------------------------------------------------
    progress.startPhase('diagnosis', 'Diagnosis');
    const merger = new MergeEngine();
    const merged = merger.merge(successResults);
    const totalFindings = merged.blockers.length +
        merged.high.length +
        merged.medium.length +
        merged.low.length;
    progress.addItem('Clustered findings');
    progress.updateItem('Clustered findings', 'done', `${totalFindings} unique issues from ${successResults.length} model${successResults.length === 1 ? '' : 's'}`);
    if (merged.consensus.length > 0) {
        progress.addItem('Consensus detected');
        progress.updateItem('Consensus detected', 'done', `${merged.consensus.length} issue${merged.consensus.length === 1 ? '' : 's'} confirmed by 2+ models`);
    }
    if (merged.conflicts.length > 0) {
        progress.addItem('Conflicts identified');
        progress.updateItem('Conflicts identified', 'done', `${merged.conflicts.length} severity disagreement${merged.conflicts.length === 1 ? '' : 's'}`);
    }
    if (!process.stdout.isTTY) {
        process.stdout.write(`[diag] ${totalFindings} issues, ${merged.consensus.length} consensus, ` +
            `${merged.conflicts.length} conflict${merged.conflicts.length === 1 ? '' : 's'}\n`);
    }
    // -------------------------------------------------------------------------
    // Phase 5: Report
    // -------------------------------------------------------------------------
    progress.startPhase('report', 'Report');
    const elapsedSec = (Date.now() - startTime) / 1000;
    const activeModelNames = successResults.map((r) => r.model);
    const report = format === 'json'
        ? generateJsonReport(merged, prompt, elapsedSec, activeModelNames)
        : generateMarkdownReport(merged, prompt, elapsedSec, activeModelNames);
    if (opts.out) {
        const outPath = resolve(opts.out);
        writeFileSync(outPath, report, 'utf8');
        progress.addItem('Saved report');
        progress.updateItem('Saved report', 'done', outPath);
    }
    else {
        progress.addItem('Generated report');
        progress.updateItem('Generated report', 'done', `${merged.blockers.length} blockers, ${merged.high.length} high, ` +
            `${merged.medium.length} medium, ${merged.low.length} low`);
    }
    // Save merged.json
    const mergedPath = join(resultsDir, 'merged.json');
    writeFileSync(mergedPath, JSON.stringify(mergedResultToDict(merged), null, 2), 'utf8');
    progress.addItem('Saved to results dir');
    progress.updateItem('Saved to results dir', 'done', 'merged.json + per-model outputs');
    if (!process.stdout.isTTY) {
        process.stdout.write(plainReportLine(merged.blockers.length, merged.high.length, merged.medium.length, merged.low.length) + '\n');
    }
    // -------------------------------------------------------------------------
    // Patches
    // -------------------------------------------------------------------------
    if (merged.patches.length > 0 && (opts.dryRun || opts.apply)) {
        if (opts.dryRun) {
            console.log('\n=== Patches (dry-run) ===\n');
            for (const patch of merged.patches) {
                console.log(`--- ${patch.path} ---`);
                console.log(patch.diff);
                console.log();
            }
        }
        else if (opts.apply) {
            if (!context.is_git_repo) {
                console.error('\nError: Cannot apply patches — not a git repository.');
                process.exit(1);
            }
            console.log(`\n${merged.patches.length} patch(es) ready.  Patch application coming soon.`);
        }
    }
    // -------------------------------------------------------------------------
    // Memory
    // -------------------------------------------------------------------------
    if (opts.remember) {
        progress.startPhase('memory', 'Memory');
        progress.addItem('Saving findings');
        writeMemory(merged, prompt);
        progress.updateItem('Saving findings', 'done', 'written to AI memory files');
    }
    // -------------------------------------------------------------------------
    // Final summary
    // -------------------------------------------------------------------------
    const totalSec = (Date.now() - startTime) / 1000;
    // Build model status summary for non-TTY display
    const modelStatuses = successResults.map((r) => ({
        name: r.model,
        status: 'done',
        findings: r.findings.length,
        time: r.elapsed_ms ? (r.elapsed_ms / 1000).toFixed(1) + 's' : '?',
    }));
    for (const fm of failedModels) {
        modelStatuses.push({ name: fm.name, status: 'failed', findings: 0, time: '-' });
    }
    progress.finish(totalSec, totalFindings, merged.consensus.length, modelStatuses, {
        s0: merged.blockers.length,
        s1: merged.high.length,
        s2: merged.medium.length,
        s3: merged.low.length,
    });
    // Print report to stdout if not writing to file
    if (!opts.out) {
        console.log('\n' + report);
    }
    if (opts.verbose) {
        process.stdout.write(`[verbose] Merged results saved to: ${mergedPath}\n`);
    }
}
// Run
main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`triage-ai: fatal error — ${msg}`);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map