/**
 * Merge and deduplicate findings from multiple models.
 *
 * Handles:
 * - Clustering similar findings
 * - Identifying consensus (2+ models agree)
 * - Detecting conflicts/disagreements
 * - Aggregating patches
 */
import { type Finding, type Patch, type ModelResult, type FindingCluster, type Conflict, type MergedResult } from './types.js';
export declare class MergeEngine {
    private similarityThreshold;
    constructor(similarityThreshold?: number);
    /**
     * Merge results from multiple models.
     */
    merge(results: ModelResult[]): MergedResult;
    /** Cluster similar findings together using greedy linear clustering. */
    _clusterFindings(findings: Finding[]): FindingCluster[];
    /** Check if a finding should be added to a cluster. */
    _shouldCluster(finding: Finding, cluster: FindingCluster): boolean;
    /** Detect disagreements between models (severity disagreements >= 2 levels). */
    _detectConflicts(clusters: FindingCluster[]): Conflict[];
    /** Aggregate unique patches from all clusters, prioritizing consensus. */
    _aggregatePatches(clusters: FindingCluster[]): Patch[];
}
/**
 * Convert a MergedResult to a plain JSON-serializable object.
 * Sets are converted to arrays.
 */
export declare function mergedResultToDict(merged: MergedResult): Record<string, unknown>;
//# sourceMappingURL=merge.d.ts.map