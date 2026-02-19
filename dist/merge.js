/**
 * Merge and deduplicate findings from multiple models.
 *
 * Handles:
 * - Clustering similar findings
 * - Identifying consensus (2+ models agree)
 * - Detecting conflicts/disagreements
 * - Aggregating patches
 */
import { findingsMatch, clusterSeverity, clusterRepresentative, clusterPatches, isConsensus, } from './types.js';
// ---------------------------------------------------------------------------
// MergeEngine
// ---------------------------------------------------------------------------
export class MergeEngine {
    similarityThreshold;
    constructor(similarityThreshold = 0.6) {
        this.similarityThreshold = similarityThreshold;
    }
    /**
     * Merge results from multiple models.
     */
    merge(results) {
        const merged = {
            blockers: [],
            high: [],
            medium: [],
            low: [],
            consensus: [],
            unique_by_model: {},
            conflicts: [],
            patches: [],
            questions: [],
            summaries: {},
        };
        // Collect all findings
        const allFindings = [];
        for (const result of results) {
            merged.summaries[result.model] = result.summary;
            merged.questions.push(...result.questions);
            for (const finding of result.findings) {
                // Ensure model is set on each finding
                const f = { ...finding, model: result.model };
                allFindings.push(f);
            }
        }
        // Cluster similar findings
        const clusters = this._clusterFindings(allFindings);
        // Categorize by severity and consensus
        for (const cluster of clusters) {
            const severity = clusterSeverity(cluster);
            if (severity === 'S0') {
                merged.blockers.push(cluster);
            }
            else if (severity === 'S1') {
                merged.high.push(cluster);
            }
            else if (severity === 'S2') {
                merged.medium.push(cluster);
            }
            else {
                merged.low.push(cluster);
            }
            if (isConsensus(cluster)) {
                merged.consensus.push(cluster);
            }
            else {
                // Single model finding
                const model = [...cluster.models][0];
                if (!merged.unique_by_model[model]) {
                    merged.unique_by_model[model] = [];
                }
                merged.unique_by_model[model].push(...cluster.findings);
            }
        }
        // Detect conflicts
        merged.conflicts = this._detectConflicts(clusters);
        // Aggregate patches
        merged.patches = this._aggregatePatches(clusters);
        // Sort by model count (descending) within each category
        const byModelCount = (a, b) => b.models.size - a.models.size;
        merged.blockers.sort(byModelCount);
        merged.high.sort(byModelCount);
        merged.medium.sort(byModelCount);
        merged.low.sort(byModelCount);
        return merged;
    }
    /** Cluster similar findings together using greedy linear clustering. */
    _clusterFindings(findings) {
        const clusters = [];
        for (const finding of findings) {
            let added = false;
            for (const cluster of clusters) {
                if (this._shouldCluster(finding, cluster)) {
                    cluster.findings.push(finding);
                    cluster.models.add(finding.model);
                    added = true;
                    break;
                }
            }
            if (!added) {
                const cluster = {
                    findings: [finding],
                    models: new Set([finding.model]),
                };
                clusters.push(cluster);
            }
        }
        return clusters;
    }
    /** Check if a finding should be added to a cluster. */
    _shouldCluster(finding, cluster) {
        for (const existing of cluster.findings) {
            if (findingsMatch(finding, existing, this.similarityThreshold)) {
                return true;
            }
        }
        return false;
    }
    /** Detect disagreements between models (severity disagreements >= 2 levels). */
    _detectConflicts(clusters) {
        const conflicts = [];
        const sevValues = { S0: 0, S1: 1, S2: 2, S3: 3 };
        for (const cluster of clusters) {
            if (cluster.findings.length < 2)
                continue;
            const severities = new Set(cluster.findings.map((f) => f.severity));
            if (severities.size > 1) {
                const sevNums = [...severities].map((s) => sevValues[s] ?? 3);
                if (Math.max(...sevNums) - Math.min(...sevNums) >= 2) {
                    const rep = clusterRepresentative(cluster);
                    conflicts.push({
                        title: rep.title,
                        findings: cluster.findings,
                        conflict_type: 'severity',
                        details: `Models disagree on severity: ${JSON.stringify([...severities])}`,
                    });
                }
            }
        }
        return conflicts;
    }
    /** Aggregate unique patches from all clusters, prioritizing consensus. */
    _aggregatePatches(clusters) {
        const patches = [];
        const seen = new Set();
        // Sort clusters by model count descending (consensus first)
        const sorted = [...clusters].sort((a, b) => b.models.size - a.models.size);
        for (const cluster of sorted) {
            for (const patch of clusterPatches(cluster)) {
                const key = `${patch.path}|${patch.diff.slice(0, 100)}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    patches.push(patch);
                }
            }
        }
        return patches;
    }
}
// ---------------------------------------------------------------------------
// Serialisation helper
// ---------------------------------------------------------------------------
/** Serialize a FindingCluster to a plain JSON-safe object. */
function clusterToDict(cluster) {
    const rep = clusterRepresentative(cluster);
    return {
        is_consensus: isConsensus(cluster),
        models: [...cluster.models],
        severity: clusterSeverity(cluster),
        representative: {
            title: rep.title,
            severity: rep.severity,
            confidence: rep.confidence,
            category: rep.category,
            location: rep.location,
            evidence: rep.evidence,
            recommendation: rep.recommendation,
            model: rep.model,
            patch: rep.patch ?? null,
        },
        all_findings: cluster.findings.map((f) => ({
            title: f.title,
            severity: f.severity,
            confidence: f.confidence,
            category: f.category,
            location: f.location,
            evidence: f.evidence,
            recommendation: f.recommendation,
            model: f.model,
            patch: f.patch ?? null,
        })),
        patches: clusterPatches(cluster).map((p) => ({
            path: p.path,
            diff: p.diff,
            description: p.description,
            model: p.model,
        })),
    };
}
/**
 * Convert a MergedResult to a plain JSON-serializable object.
 * Sets are converted to arrays.
 */
export function mergedResultToDict(merged) {
    return {
        blockers: merged.blockers.map(clusterToDict),
        high: merged.high.map(clusterToDict),
        medium: merged.medium.map(clusterToDict),
        low: merged.low.map(clusterToDict),
        consensus: merged.consensus.map(clusterToDict),
        unique_by_model: Object.fromEntries(Object.entries(merged.unique_by_model).map(([model, findings]) => [
            model,
            findings.map((f) => ({
                title: f.title,
                severity: f.severity,
                confidence: f.confidence,
                category: f.category,
                location: f.location,
                evidence: f.evidence,
                recommendation: f.recommendation,
                model: f.model,
                patch: f.patch ?? null,
            })),
        ])),
        conflicts: merged.conflicts.map((c) => ({
            title: c.title,
            type: c.conflict_type,
            details: c.details,
            findings: c.findings.map((f) => ({
                title: f.title,
                severity: f.severity,
                confidence: f.confidence,
                category: f.category,
                location: f.location,
                evidence: f.evidence,
                recommendation: f.recommendation,
                model: f.model,
                patch: f.patch ?? null,
            })),
        })),
        patches: merged.patches.map((p) => ({
            path: p.path,
            diff: p.diff,
            description: p.description,
            model: p.model,
        })),
        questions: merged.questions,
        summaries: merged.summaries,
    };
}
//# sourceMappingURL=merge.js.map