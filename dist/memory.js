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
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { clusterRepresentative, isConsensus } from './types.js';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const MEMORY_START = '<!-- triage:start -->';
export const MEMORY_END = '<!-- triage:end -->';
export const MEMORY_FILES = {
    claude: 'CLAUDE.md',
    gemini: 'GEMINI.md',
    codex: 'AGENTS.md',
};
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Write triage findings to AI model memory files.
 *
 * Replaces any existing triage section (between markers) or appends
 * a new one. This keeps memory current — old findings are replaced by
 * the latest run, not accumulated forever.
 */
export async function writeMemory(merged, prompt, root, models) {
    const rootDir = root ?? process.cwd();
    const targetModels = models ?? Object.keys(MEMORY_FILES);
    const content = _buildMemoryContent(merged, prompt);
    if (!content) {
        // No findings — clear any stale triage blocks
        return clearMemory(rootDir, targetModels);
    }
    const results = {};
    for (const model of targetModels) {
        const filename = MEMORY_FILES[model];
        if (!filename)
            continue;
        const filepath = join(rootDir, filename);
        const success = await _updateMemoryFile(filepath, content);
        results[filename] = success;
        if (success) {
            console.log(`  Updated ${filename} with triage findings`);
        }
    }
    return results;
}
/**
 * Remove triage sections from AI model memory files.
 */
export async function clearMemory(root, models) {
    const rootDir = root ?? process.cwd();
    const targetModels = models ?? Object.keys(MEMORY_FILES);
    const results = {};
    for (const model of targetModels) {
        const filename = MEMORY_FILES[model];
        if (!filename)
            continue;
        const filepath = join(rootDir, filename);
        if (!existsSync(filepath))
            continue;
        try {
            const existing = await readFile(filepath, 'utf-8');
            if (!existing.includes(MEMORY_START))
                continue;
            if (!existing.includes(MEMORY_END)) {
                console.log(`  Warning: ${filename} has start marker but no end marker — skipping`);
                continue;
            }
            // Remove the triage section
            const before = existing.slice(0, existing.indexOf(MEMORY_START)).trimEnd();
            const afterIdx = existing.indexOf(MEMORY_END) + MEMORY_END.length;
            const after = existing.slice(afterIdx).replace(/^\n+/, '');
            let newContent = before;
            if (after) {
                newContent += '\n\n' + after;
            }
            newContent = newContent.trimEnd() + '\n';
            await writeFile(filepath, newContent, 'utf-8');
            results[filename] = true;
            console.log(`  Cleared triage section from ${filename}`);
        }
        catch (e) {
            console.log(`  Failed to clear ${filename}: ${e}`);
            results[filename] = false;
        }
    }
    return results;
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/** Build the memory content block from merged results. */
export function _buildMemoryContent(merged, prompt) {
    const total = merged.blockers.length +
        merged.high.length +
        merged.medium.length +
        merged.low.length;
    if (total === 0)
        return '';
    const now = new Date();
    const timestamp = now.getFullYear() +
        '-' +
        String(now.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(now.getDate()).padStart(2, '0') +
        ' ' +
        String(now.getHours()).padStart(2, '0') +
        ':' +
        String(now.getMinutes()).padStart(2, '0');
    const lines = [];
    lines.push(MEMORY_START);
    lines.push('');
    lines.push('## Triage Findings');
    lines.push('');
    lines.push(`*Last run: ${timestamp} — ${total} issues found, ${merged.consensus.length} consensus*`);
    lines.push('');
    if (prompt) {
        lines.push(`> **Scope:** ${prompt}`);
        lines.push('');
    }
    // Blockers — full detail
    if (merged.blockers.length > 0) {
        lines.push('### Blockers (must fix)');
        lines.push('');
        for (const cluster of merged.blockers) {
            lines.push(..._formatCluster(cluster));
        }
        lines.push('');
    }
    // High priority — full detail
    if (merged.high.length > 0) {
        lines.push('### High Priority');
        lines.push('');
        for (const cluster of merged.high) {
            lines.push(..._formatCluster(cluster));
        }
        lines.push('');
    }
    // Medium — summary only to keep memory concise
    if (merged.medium.length > 0) {
        lines.push('### Medium Priority');
        lines.push('');
        for (const cluster of merged.medium) {
            const f = clusterRepresentative(cluster);
            const consensusTag = isConsensus(cluster) ? ' **(consensus)**' : '';
            lines.push(`- [${f.severity}] ${f.title} — \`${f.location.path}:${f.location.start_line}\`${consensusTag}`);
        }
        lines.push('');
    }
    // Low — just a count
    if (merged.low.length > 0) {
        lines.push(`*Plus ${merged.low.length} low-priority items (S3).*`);
        lines.push('');
    }
    // Patterns to watch from consensus
    if (merged.consensus.length > 0) {
        lines.push('### Patterns to Watch');
        lines.push('');
        lines.push('These issues were flagged by multiple models — avoid introducing similar patterns:');
        lines.push('');
        for (const cluster of merged.consensus) {
            const f = clusterRepresentative(cluster);
            lines.push(`- **${f.title}**: ${f.recommendation}`);
        }
        lines.push('');
    }
    lines.push(MEMORY_END);
    return lines.join('\n');
}
/** Format a finding cluster for memory output. */
export function _formatCluster(cluster) {
    const lines = [];
    const f = clusterRepresentative(cluster);
    const consensusTag = isConsensus(cluster) ? ' **(consensus)**' : '';
    const models = [...cluster.models].sort().join(', ');
    lines.push(`- **[${f.severity}] ${f.title}**${consensusTag}`);
    lines.push(`  - Location: \`${f.location.path}:${f.location.start_line}-${f.location.end_line}\``);
    lines.push(`  - Models: ${models}`);
    if (f.recommendation) {
        let rec = f.recommendation.slice(0, 200);
        if (f.recommendation.length > 200)
            rec += '...';
        lines.push(`  - Fix: ${rec}`);
    }
    return lines;
}
/**
 * Update a memory file with triage content.
 *
 * - If the file has an existing triage section, replace it.
 * - If the file exists without a triage section, append.
 * - If the file does not exist, create it with a minimal header.
 */
export async function _updateMemoryFile(filepath, content) {
    try {
        if (existsSync(filepath)) {
            const existing = await readFile(filepath, 'utf-8');
            let newContent;
            if (existing.includes(MEMORY_START) && existing.includes(MEMORY_END)) {
                // Replace existing triage section
                const before = existing.slice(0, existing.indexOf(MEMORY_START)).trimEnd();
                const afterIdx = existing.indexOf(MEMORY_END) + MEMORY_END.length;
                const after = existing.slice(afterIdx).replace(/^\n+/, '');
                newContent = before + '\n\n' + content;
                if (after) {
                    newContent += '\n\n' + after;
                }
                newContent = newContent.trimEnd() + '\n';
            }
            else {
                // Append triage section
                newContent = existing.trimEnd() + '\n\n' + content + '\n';
            }
            await writeFile(filepath, newContent, 'utf-8');
        }
        else {
            // Create new file with minimal header
            const filename = filepath.split('/').pop()?.replace('.md', '') ?? 'Memory';
            const newContent = `# ${filename}\n\n${content}\n`;
            await writeFile(filepath, newContent, 'utf-8');
        }
        return true;
    }
    catch (e) {
        const filename = filepath.split('/').pop() ?? filepath;
        console.log(`  Failed to write ${filename}: ${e}`);
        return false;
    }
}
//# sourceMappingURL=memory.js.map