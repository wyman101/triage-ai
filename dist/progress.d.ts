/**
 * Triage progress display — rich (TTY) and plain (CI/piped) modes.
 *
 * Rich TTY mode uses chalk colours and ora spinners, rendered with
 * box-drawing characters.  Plain mode emits simple bracketed lines
 * so CI logs stay readable.
 */
import type { ProgressPhase } from './types.js';
export declare class TriageProgress {
    private readonly isTTY;
    private currentPhase;
    private items;
    constructor();
    /**
     * Begin a new phase.  Finishes any active spinner from the previous phase
     * and prints the phase header.
     */
    startPhase(phase: ProgressPhase, title: string): void;
    /**
     * Register a pending item under the current phase.
     * Prints a placeholder line in TTY mode.
     */
    addItem(label: string, detail?: string): void;
    /**
     * Update an already-added item to done / failed / skipped.
     * In TTY mode this re-prints the line in place only when there is no active
     * spinner (the spinner path goes through stopSpinner instead).
     */
    updateItem(label: string, status: 'done' | 'failed' | 'skipped', detail?: string): void;
    /**
     * Start an ora spinner for the given item.  The spinner persists until
     * `stopSpinner` is called.
     */
    startSpinner(label: string, detail?: string, timeoutSec?: number): void;
    /**
     * Stop a running spinner and mark the item done or failed.
     */
    stopSpinner(label: string, status: 'done' | 'failed', detail?: string): void;
    /**
     * Print the final summary line.
     *
     * @param totalTime       Total wall-clock seconds
     * @param totalFindings   Number of unique findings
     * @param consensusCount  Number confirmed by 2+ models
     */
    finish(totalTime: number, totalFindings: number, consensusCount: number, modelStatuses?: Array<{
        name: string;
        status: string;
        findings: number;
        time: string;
        parsed_as?: string;
    }>, severities?: {
        s0: number;
        s1: number;
        s2: number;
        s3: number;
    }, contextTruncated?: boolean): void;
    /**
     * Print the very first header line.  Call once at startup.
     */
    printHeader(): void;
    private _itemText;
    private _printItem;
    private _plainItem;
    private _sym;
    private _phaseName;
    private _phaseNumber;
    private _stopAllSpinners;
}
/**
 * Format a plain-mode team summary line.
 * Example: "[team] Claude ✓, Gemini ✓, Codex ✗"
 */
export declare function plainTeamLine(results: Array<{
    name: string;
    available: boolean;
}>): string;
/**
 * Format a plain-mode severity breakdown line.
 * Example: "[report] 3 S0, 5 S1, 8 S2, 6 S3"
 */
export declare function plainReportLine(s0: number, s1: number, s2: number, s3: number): string;
//# sourceMappingURL=progress.d.ts.map