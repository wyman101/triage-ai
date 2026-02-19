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
import { homedir } from 'node:os';
import which from 'which';
import { TriageProgress, plainTeamLine, plainReportLine } from './progress.js';
import { RepoScanner } from './scanner.js';
import { MergeEngine, mergedResultToDict } from './merge.js';
import { startMcpServer } from './mcp-server.js';
// ---------------------------------------------------------------------------
// Version (aligned with package.json)
// ---------------------------------------------------------------------------
const VERSION = '1.0.7';
// ---------------------------------------------------------------------------
// Config path
// ---------------------------------------------------------------------------
const CONFIG_DIR = join(homedir(), '.config', 'triage-ai');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
// ---------------------------------------------------------------------------
// Auth / rate-limit error patterns (mirrors base.ts)
// ---------------------------------------------------------------------------
const AUTH_PATTERNS = [
    /not logged in/i,
    /login required/i,
    /authenticate/i,
    /api[_\s-]?key/i,
    /ANTHROPIC_API_KEY/,
    /GOOGLE_API_KEY/,
    /OPENAI_API_KEY/,
    /rate[_\s-]?limit/i,
    /quota exceeded/i,
    /too many requests/i,
    /429/,
    /unauthorized/i,
    /forbidden/i,
    /403/,
];
function detectAuthIssue(modelName, errorMsg) {
    for (const pat of AUTH_PATTERNS) {
        if (pat.test(errorMsg)) {
            return _authHint(modelName, errorMsg);
        }
    }
    return null;
}
function _authHint(modelName, errorMsg) {
    const lower = errorMsg.toLowerCase();
    const name = modelName.toLowerCase();
    if (/rate.?limit|too many|429|quota/.test(lower)) {
        const others = ['claude', 'gemini', 'codex'].filter((m) => m !== name).join(',');
        return `rate limited — try again later or use --models ${others}`;
    }
    if (/unauthorized|forbidden|403/.test(lower)) {
        return `access denied — check your API key or permissions`;
    }
    if (name === 'claude')
        return 'not authenticated — run: claude auth login';
    if (name === 'gemini')
        return 'not authenticated — run: gemini auth login';
    if (name === 'codex')
        return 'not authenticated — run: codex (or set OPENAI_API_KEY)';
    return 'not authenticated — check API key or run the CLI interactively to log in';
}
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
    // Setup sub-command — handle before parse so we can await it
    if (process.argv[2] === 'setup') {
        await runSetup();
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
    for (const tool of tools) {
        progress.addItem(tool.name);
        if (tool.available) {
            progress.updateItem(tool.name, 'done', `found at ${tool.path ?? tool.command}`);
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
        console.error(`Results directory: ${resultsDir}`);
    }
    const startTime = Date.now();
    // Start a spinner per available model
    for (const tool of availableTools) {
        progress.startSpinner(tool.name, 'examining codebase…');
    }
    // Run all models in parallel; Promise.allSettled so one failure doesn't
    // cancel the others.
    const modelRuns = availableTools.map(async (tool) => {
        const modelStart = Date.now();
        try {
            const model = await loadModel(tool.command);
            model.contextOnly = opts.contextOnly;
            const result = await model.analyze(prompt, context, resultsDir, timeout, nice);
            const elapsed = ((Date.now() - modelStart) / 1000).toFixed(1) + 's';
            progress.stopSpinner(tool.name, 'done', `${result.findings.length} findings (${elapsed})`);
            return { tool, result, error: null };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const authMsg = detectAuthIssue(tool.name, msg);
            progress.stopSpinner(tool.name, 'failed', authMsg ?? msg.slice(0, 100));
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
        if (result) {
            successResults.push(result);
        }
        else {
            failedModels.push({ name: tool.name, error: error ?? 'unknown error' });
        }
    }
    if (successResults.length === 0) {
        console.error('\nError: All models failed.\n');
        for (const fm of failedModels) {
            const authMsg = detectAuthIssue(fm.name, fm.error);
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
    progress.finish(totalSec, totalFindings, merged.consensus.length);
    // Print report to stdout if not writing to file
    if (!opts.out) {
        console.log('\n' + report);
    }
    if (opts.verbose) {
        console.error(`\nMerged results saved to: ${mergedPath}`);
    }
}
// Run
main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`triage-ai: fatal error — ${msg}`);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map