/**
 * Triage progress display — rich (TTY) and plain (CI/piped) modes.
 *
 * Rich TTY mode uses chalk colours and ora spinners, rendered with
 * box-drawing characters.  Plain mode emits simple bracketed lines
 * so CI logs stay readable.
 */
import chalk from 'chalk';
import ora from 'ora';
// ---------------------------------------------------------------------------
// Version — kept in sync with package.json at runtime
// ---------------------------------------------------------------------------
const VERSION = '1.0.7';
// ---------------------------------------------------------------------------
// Box-drawing helpers
// ---------------------------------------------------------------------------
const BOX = {
    top: '┌',
    mid: '├',
    pipe: '│',
    bottom: '└',
    dot: '·',
};
// ---------------------------------------------------------------------------
// Status symbols and colours
// ---------------------------------------------------------------------------
const SYM_DONE = chalk.green('✓');
const SYM_FAIL = chalk.red('✗');
const SYM_SKIP = chalk.dim('—');
const SYM_PENDING = chalk.dim(BOX.dot);
function phaseColour(phase) {
    switch (phase) {
        case 'intake': return chalk.cyan;
        case 'team': return chalk.blue;
        case 'assessment': return chalk.yellow;
        case 'diagnosis': return chalk.magenta;
        case 'report': return chalk.green;
        case 'memory': return chalk.white;
    }
}
// ---------------------------------------------------------------------------
// TriageProgress
// ---------------------------------------------------------------------------
export class TriageProgress {
    isTTY;
    currentPhase = null;
    items = new Map();
    constructor() {
        this.isTTY = Boolean(process.stdout.isTTY);
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    /**
     * Begin a new phase.  Finishes any active spinner from the previous phase
     * and prints the phase header.
     */
    startPhase(phase, title) {
        this._stopAllSpinners();
        this.items.clear();
        this.currentPhase = phase;
        if (this.isTTY) {
            process.stdout.write('\n');
            const colour = phaseColour(phase);
            process.stdout.write(chalk.dim(BOX.mid) + ' ' + colour.bold(title) + '\n');
        }
        // Plain mode: phase name appears inline on each item line.
    }
    /**
     * Register a pending item under the current phase.
     * Prints a placeholder line in TTY mode.
     */
    addItem(label, detail) {
        const item = {
            label,
            status: 'pending',
            detail,
            spinner: null,
        };
        this.items.set(label, item);
        if (this.isTTY) {
            const detailStr = detail ? chalk.dim('  ' + detail) : '';
            process.stdout.write(chalk.dim(BOX.pipe) + '  ' + SYM_PENDING + ' ' + chalk.dim(label) + detailStr + '\n');
        }
    }
    /**
     * Update an already-added item to done / failed / skipped.
     * In TTY mode this re-prints the line in place only when there is no active
     * spinner (the spinner path goes through stopSpinner instead).
     */
    updateItem(label, status, detail) {
        const item = this.items.get(label);
        if (!item) {
            // Auto-create the item if it was never added
            this.addItem(label, detail);
            return this.updateItem(label, status, detail);
        }
        if (item.spinner) {
            this.stopSpinner(label, status === 'failed' ? 'failed' : 'done', detail);
            return;
        }
        item.status = status;
        if (detail !== undefined)
            item.detail = detail;
        if (this.isTTY) {
            this._printItem(item);
        }
        else {
            this._plainItem(item);
        }
    }
    /**
     * Start an ora spinner for the given item.  The spinner persists until
     * `stopSpinner` is called.
     */
    startSpinner(label, detail) {
        if (!this.items.has(label)) {
            const item = { label, status: 'running', detail, spinner: null };
            this.items.set(label, item);
        }
        const item = this.items.get(label);
        item.status = 'running';
        if (detail !== undefined)
            item.detail = detail;
        if (this.isTTY) {
            const spinner = ora({
                text: this._itemText(item),
                prefixText: chalk.dim(BOX.pipe) + '  ',
                color: 'yellow',
            });
            spinner.start();
            item.spinner = spinner;
        }
        else {
            process.stdout.write(`[${this._phaseName()}] ${label}…\n`);
        }
    }
    /**
     * Stop a running spinner and mark the item done or failed.
     */
    stopSpinner(label, status, detail) {
        const item = this.items.get(label);
        if (!item)
            return;
        item.status = status;
        if (detail !== undefined)
            item.detail = detail;
        if (this.isTTY && item.spinner) {
            const text = this._itemText(item);
            if (status === 'done') {
                item.spinner.succeed(chalk.dim(BOX.pipe) + '  ' + text);
            }
            else {
                item.spinner.fail(chalk.dim(BOX.pipe) + '  ' + text);
            }
            item.spinner = null;
        }
        else if (!this.isTTY) {
            this._plainItem(item);
        }
    }
    /**
     * Print the final summary line.
     *
     * @param totalTime       Total wall-clock seconds
     * @param totalFindings   Number of unique findings
     * @param consensusCount  Number confirmed by 2+ models
     */
    finish(totalTime, totalFindings, consensusCount) {
        this._stopAllSpinners();
        const timeStr = totalTime.toFixed(1) + 's';
        const summary = `${totalFindings} findings, ${consensusCount} consensus`;
        if (this.isTTY) {
            process.stdout.write('\n');
            process.stdout.write(chalk.dim(BOX.bottom) + ' ' +
                chalk.bold('Done') + ' in ' + chalk.cyan(timeStr) +
                ' — ' + chalk.yellow(summary) + '\n');
        }
        else {
            process.stdout.write(`[done] ${timeStr} — ${summary}\n`);
        }
    }
    /**
     * Print the very first header line.  Call once at startup.
     */
    printHeader() {
        if (this.isTTY) {
            process.stdout.write(chalk.dim(BOX.top) + ' ' + chalk.bold.white('triage-ai') +
                ' ' + chalk.dim('v' + VERSION) + '\n');
        }
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    _itemText(item) {
        const sym = this._sym(item.status);
        let labelPart;
        switch (item.status) {
            case 'running':
            case 'done':
                labelPart = chalk.white(item.label);
                break;
            case 'failed':
                labelPart = chalk.red(item.label);
                break;
            default:
                labelPart = chalk.dim(item.label);
        }
        const padding = ' '.padEnd(Math.max(1, 32 - item.label.length));
        const detailPart = item.detail ? chalk.dim(padding + item.detail) : '';
        return `${sym} ${labelPart}${detailPart}`;
    }
    _printItem(item) {
        process.stdout.write(chalk.dim(BOX.pipe) + '  ' + this._itemText(item) + '\n');
    }
    _plainItem(item) {
        const phase = this._phaseName();
        const sym = item.status === 'done' ? '✓' : item.status === 'failed' ? '✗' : '—';
        const detail = item.detail ? ` (${item.detail})` : '';
        process.stdout.write(`[${phase}] ${item.label} ${sym}${detail}\n`);
    }
    _sym(status) {
        switch (status) {
            case 'done': return SYM_DONE;
            case 'failed': return SYM_FAIL;
            case 'skipped': return SYM_SKIP;
            default: return SYM_PENDING;
        }
    }
    _phaseName() {
        switch (this.currentPhase) {
            case 'intake': return 'intake';
            case 'team': return 'team';
            case 'assessment': return 'assess';
            case 'diagnosis': return 'diag';
            case 'report': return 'report';
            case 'memory': return 'memory';
            default: return 'triage';
        }
    }
    _stopAllSpinners() {
        for (const item of this.items.values()) {
            if (item.spinner) {
                item.spinner.stop();
                item.spinner = null;
            }
        }
    }
}
// ---------------------------------------------------------------------------
// Plain-mode convenience helpers (used by cli.ts for team / report)
// ---------------------------------------------------------------------------
/**
 * Format a plain-mode team summary line.
 * Example: "[team] Claude ✓, Gemini ✓, Codex ✗"
 */
export function plainTeamLine(results) {
    const parts = results.map((r) => `${r.name} ${r.available ? '✓' : '✗'}`);
    return `[team] ${parts.join(', ')}`;
}
/**
 * Format a plain-mode severity breakdown line.
 * Example: "[report] 3 S0, 5 S1, 8 S2, 6 S3"
 */
export function plainReportLine(s0, s1, s2, s3) {
    return `[report] ${s0} S0, ${s1} S1, ${s2} S2, ${s3} S3`;
}
//# sourceMappingURL=progress.js.map