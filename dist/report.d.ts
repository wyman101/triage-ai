/**
 * Report generation in Markdown and JSON formats.
 */
import { type MergedResult, type FindingCluster, type ScanContext } from './types.js';
export declare class ReportGenerator {
    /**
     * Generate a Markdown report from merged results.
     *
     * Matches the exact section order and formatting of the Python original.
     */
    toMarkdown(merged: MergedResult, prompt: string, context: ScanContext, elapsed: number): string;
    /** Render a single finding cluster as Markdown lines. */
    _renderCluster(cluster: FindingCluster, index: number): string[];
    /**
     * Generate a JSON report from merged results.
     */
    toJson(merged: MergedResult, prompt: string, context: ScanContext, elapsed: number): string;
}
//# sourceMappingURL=report.d.ts.map