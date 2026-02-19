/**
 * Report generation in Markdown and JSON formats.
 */
import { clusterRepresentative, clusterPatches, isConsensus, } from './types.js';
import { mergedResultToDict } from './merge.js';
// ---------------------------------------------------------------------------
// ReportGenerator
// ---------------------------------------------------------------------------
export class ReportGenerator {
    /**
     * Generate a Markdown report from merged results.
     *
     * Matches the exact section order and formatting of the Python original.
     */
    toMarkdown(merged, prompt, context, elapsed) {
        const lines = [];
        // ---- Header ----
        lines.push('# Code Triage Report');
        lines.push('');
        lines.push(`**Generated:** ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
        lines.push(`**Duration:** ${elapsed.toFixed(1)}s`);
        lines.push(`**Models:** ${Object.keys(merged.summaries).join(', ')}`);
        lines.push('');
        // ---- Request ----
        lines.push('## Request');
        lines.push('');
        lines.push(`> ${prompt}`);
        lines.push('');
        // ---- Summary ----
        lines.push('## Summary');
        lines.push('');
        const total = merged.blockers.length +
            merged.high.length +
            merged.medium.length +
            merged.low.length;
        const consensusCount = merged.consensus.length;
        lines.push(`- **Total Issues:** ${total}`);
        lines.push(`- **Consensus (2+ models):** ${consensusCount}`);
        lines.push(`- **Blockers (S0):** ${merged.blockers.length}`);
        lines.push(`- **High (S1):** ${merged.high.length}`);
        lines.push(`- **Medium (S2):** ${merged.medium.length}`);
        lines.push(`- **Low (S3):** ${merged.low.length}`);
        lines.push('');
        // ---- Model Assessments ----
        lines.push('### Model Assessments');
        lines.push('');
        for (const [model, summary] of Object.entries(merged.summaries)) {
            lines.push(`**${model.toUpperCase()}:** ${summary}`);
            lines.push('');
        }
        // ---- Blockers ----
        if (merged.blockers.length > 0) {
            lines.push('## Blockers (S0)');
            lines.push('');
            for (let i = 0; i < merged.blockers.length; i++) {
                lines.push(...this._renderCluster(merged.blockers[i], i + 1));
            }
        }
        // ---- High ----
        if (merged.high.length > 0) {
            lines.push('## High Priority (S1)');
            lines.push('');
            for (let i = 0; i < merged.high.length; i++) {
                lines.push(...this._renderCluster(merged.high[i], i + 1));
            }
        }
        // ---- Medium ----
        if (merged.medium.length > 0) {
            lines.push('## Medium Priority (S2)');
            lines.push('');
            for (let i = 0; i < merged.medium.length; i++) {
                lines.push(...this._renderCluster(merged.medium[i], i + 1));
            }
        }
        // ---- Low ----
        if (merged.low.length > 0) {
            lines.push('## Low Priority (S3)');
            lines.push('');
            for (let i = 0; i < merged.low.length; i++) {
                lines.push(...this._renderCluster(merged.low[i], i + 1));
            }
        }
        // ---- Consensus Findings ----
        if (merged.consensus.length > 0) {
            lines.push('## Consensus Findings');
            lines.push('');
            lines.push('*Issues identified by 2+ models:*');
            lines.push('');
            for (const cluster of merged.consensus) {
                const f = clusterRepresentative(cluster);
                const models = [...cluster.models].sort().join(', ');
                lines.push(`- [${f.severity}] **${f.title}** (${f.location.path}) - *${models}*`);
            }
            lines.push('');
        }
        // ---- Unique Findings by Model ----
        if (Object.keys(merged.unique_by_model).length > 0) {
            lines.push('## Unique Findings by Model');
            lines.push('');
            for (const [model, findings] of Object.entries(merged.unique_by_model).sort()) {
                if (findings.length > 0) {
                    lines.push(`### ${model.toUpperCase()} only (${findings.length})`);
                    lines.push('');
                    for (const f of findings) {
                        lines.push(`- [${f.severity}] ${f.title} (${f.location.path})`);
                    }
                    lines.push('');
                }
            }
        }
        // ---- Conflicts / Disagreements ----
        if (merged.conflicts.length > 0) {
            lines.push('## Conflicts / Disagreements');
            lines.push('');
            for (const conflict of merged.conflicts) {
                lines.push(`### ${conflict.title}`);
                lines.push(`*Type: ${conflict.conflict_type}*`);
                lines.push('');
                lines.push(conflict.details);
                lines.push('');
            }
        }
        // ---- Proposed Patches ----
        if (merged.patches.length > 0) {
            lines.push('## Proposed Patches');
            lines.push('');
            for (let i = 0; i < merged.patches.length; i++) {
                const patch = merged.patches[i];
                lines.push(`### Patch ${i + 1}: ${patch.description} (${patch.model})`);
                lines.push(`*File: ${patch.path}*`);
                lines.push('');
                lines.push('```diff');
                lines.push(patch.diff);
                lines.push('```');
                lines.push('');
            }
        }
        // ---- Open Questions ----
        if (merged.questions.length > 0) {
            lines.push('## Open Questions');
            lines.push('');
            for (const q of merged.questions) {
                lines.push(`- ${q}`);
            }
            lines.push('');
        }
        // ---- Recommended Plan ----
        lines.push('## Recommended Plan');
        lines.push('');
        const planItems = [];
        // Blockers first
        for (const cluster of merged.blockers) {
            const f = clusterRepresentative(cluster);
            const tag = isConsensus(cluster) ? ' (consensus)' : '';
            planItems.push(`1. **[BLOCKER]** ${f.title} - ${f.location.path}${tag}`);
        }
        // High priority consensus
        for (const cluster of merged.high) {
            if (isConsensus(cluster)) {
                const f = clusterRepresentative(cluster);
                planItems.push(`2. **[HIGH]** ${f.title} - ${f.location.path} (consensus)`);
            }
        }
        // Remaining high
        for (const cluster of merged.high) {
            if (!isConsensus(cluster)) {
                const f = clusterRepresentative(cluster);
                planItems.push(`3. **[HIGH]** ${f.title} - ${f.location.path}`);
            }
        }
        if (planItems.length > 0) {
            lines.push(...planItems.slice(0, 10)); // Top 10 actions
        }
        else {
            lines.push('No critical issues found. Consider reviewing medium/low findings.');
        }
        lines.push('');
        lines.push('---');
        lines.push('*Report generated by triage-ai v1.0.6*');
        return lines.join('\n');
    }
    /** Render a single finding cluster as Markdown lines. */
    _renderCluster(cluster, index) {
        const lines = [];
        const f = clusterRepresentative(cluster);
        const consensusTag = isConsensus(cluster) ? ' [CONSENSUS]' : '';
        const models = [...cluster.models].sort().join(', ');
        lines.push(`### ${index}. ${f.title}${consensusTag}`);
        lines.push('');
        lines.push(`- **Severity:** ${f.severity}`);
        lines.push(`- **Confidence:** ${f.confidence}`);
        lines.push(`- **Category:** ${f.category}`);
        lines.push(`- **Location:** \`${f.location.path}:${f.location.start_line}-${f.location.end_line}\``);
        lines.push(`- **Models:** ${models}`);
        lines.push('');
        if (f.evidence) {
            lines.push('**Evidence:**');
            lines.push('```');
            lines.push(f.evidence.slice(0, 500));
            lines.push('```');
            lines.push('');
        }
        if (f.recommendation) {
            lines.push(`**Recommendation:** ${f.recommendation}`);
            lines.push('');
        }
        // Show first patch if any
        const patches = clusterPatches(cluster);
        if (patches.length > 0) {
            lines.push('**Proposed fix:**');
            lines.push('```diff');
            lines.push(patches[0].diff.slice(0, 1000));
            lines.push('```');
            lines.push('');
        }
        return lines;
    }
    /**
     * Generate a JSON report from merged results.
     */
    toJson(merged, prompt, context, elapsed) {
        const report = {
            metadata: {
                generated: new Date().toISOString(),
                duration_seconds: elapsed,
                prompt,
                models: Object.keys(merged.summaries),
            },
            summary: {
                total_issues: merged.blockers.length +
                    merged.high.length +
                    merged.medium.length +
                    merged.low.length,
                consensus_count: merged.consensus.length,
                blockers: merged.blockers.length,
                high: merged.high.length,
                medium: merged.medium.length,
                low: merged.low.length,
            },
            results: mergedResultToDict(merged),
        };
        return JSON.stringify(report, null, 2);
    }
}
//# sourceMappingURL=report.js.map