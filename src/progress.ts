/**
 * Triage progress display — rich (TTY) and plain (CI/piped) modes.
 *
 * Rich TTY mode uses chalk colours and ora spinners, rendered with
 * box-drawing characters.  Plain mode emits simple bracketed lines
 * so CI logs stay readable.
 */

import chalk, { type ChalkInstance } from 'chalk';
import ora, { type Ora } from 'ora';
import type { ProgressPhase, PhaseItem } from './types.js';
import { createRequire } from 'node:module';

// ---------------------------------------------------------------------------
// Version — read from package.json so it stays in sync automatically
// ---------------------------------------------------------------------------

const _require = createRequire(import.meta.url);
const VERSION: string = (_require('../package.json') as { version: string }).version;

// ---------------------------------------------------------------------------
// Box-drawing helpers
// ---------------------------------------------------------------------------

const BOX = {
  top:    '┌',
  mid:    '├',
  pipe:   '│',
  bottom: '└',
  dot:    '·',
} as const;

// ---------------------------------------------------------------------------
// Status symbols and colours
// ---------------------------------------------------------------------------

const SYM_DONE    = chalk.green('✓');
const SYM_FAIL    = chalk.red('✗');
const SYM_SKIP    = chalk.dim('—');
const SYM_PENDING = chalk.dim(BOX.dot);

function phaseColour(phase: ProgressPhase): ChalkInstance {
  switch (phase) {
    case 'intake':     return chalk.cyan;
    case 'team':       return chalk.blue;
    case 'assessment': return chalk.yellow;
    case 'diagnosis':  return chalk.magenta;
    case 'report':     return chalk.green;
    case 'memory':     return chalk.white;
  }
}

// ---------------------------------------------------------------------------
// PhaseItem tracker (internal)
// ---------------------------------------------------------------------------

interface TrackedItem extends PhaseItem {
  spinner: Ora | null;
  _timer?: ReturnType<typeof setInterval>;
  _startTime?: number;
}

// ---------------------------------------------------------------------------
// TriageProgress
// ---------------------------------------------------------------------------

export class TriageProgress {
  private readonly isTTY: boolean;
  private currentPhase: ProgressPhase | null = null;
  private items: Map<string, TrackedItem> = new Map();

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
  startPhase(phase: ProgressPhase, title: string): void {
    this._stopAllSpinners();
    this.items.clear();

    this.currentPhase = phase;

    if (this.isTTY) {
      process.stdout.write('\n');
      const colour = phaseColour(phase);
      process.stdout.write(chalk.dim(BOX.mid) + ' ' + colour.bold(title) + '\n');
    } else {
      // Plain mode: print phase header for readability
      const num = this._phaseNumber();
      process.stdout.write(`\n--- Phase ${num}: ${title} ---\n`);
    }
  }

  /**
   * Register a pending item under the current phase.
   * Prints a placeholder line in TTY mode.
   */
  addItem(label: string, detail?: string): void {
    const item: TrackedItem = {
      label,
      status: 'pending',
      detail,
      spinner: null,
    };
    this.items.set(label, item);

    if (this.isTTY) {
      const detailStr = detail ? chalk.dim('  ' + detail) : '';
      process.stdout.write(
        chalk.dim(BOX.pipe) + '  ' + SYM_PENDING + ' ' + chalk.dim(label) + detailStr + '\n',
      );
    }
  }

  /**
   * Update an already-added item to done / failed / skipped.
   * In TTY mode this re-prints the line in place only when there is no active
   * spinner (the spinner path goes through stopSpinner instead).
   */
  updateItem(label: string, status: 'done' | 'failed' | 'skipped', detail?: string): void {
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
    if (detail !== undefined) item.detail = detail;

    if (this.isTTY) {
      this._printItem(item);
    } else {
      this._plainItem(item);
    }
  }

  /**
   * Start an ora spinner for the given item.  The spinner persists until
   * `stopSpinner` is called.
   */
  startSpinner(label: string, detail?: string, timeoutSec?: number): void {
    if (!this.items.has(label)) {
      const item: TrackedItem = { label, status: 'running', detail, spinner: null };
      this.items.set(label, item);
    }

    const item = this.items.get(label)!;
    item.status = 'running';
    item._startTime = Date.now();
    if (detail !== undefined) item.detail = detail;

    if (this.isTTY) {
      const spinner = ora({
        text: this._itemText(item),
        prefixText: chalk.dim(BOX.pipe) + '  ',
        color: 'yellow',
      });
      spinner.start();
      item.spinner = spinner;

      // Update spinner with elapsed time every 15s
      item._timer = setInterval(() => {
        const elapsed = Math.round((Date.now() - item._startTime!) / 1000);
        const warnStr = timeoutSec && elapsed > timeoutSec * 0.8
          ? ' ⚠ approaching timeout' : '';
        const baseDetail = detail ?? 'running';
        item.detail = `${baseDetail} ${elapsed}s${warnStr}`;
        if (item.spinner) {
          item.spinner.text = this._itemText(item);
        }
      }, 15_000);
    } else {
      process.stdout.write(`[${this._phaseName()}] ${label}…\n`);

      // Periodic status for non-TTY (CI / AI orchestrators)
      item._timer = setInterval(() => {
        const elapsed = Math.round((Date.now() - item._startTime!) / 1000);
        const warnStr = timeoutSec && elapsed > timeoutSec * 0.8
          ? ' (approaching timeout)' : '';
        process.stdout.write(`[${this._phaseName()}] ${label}… ${elapsed}s${warnStr}\n`);
      }, 30_000);
    }
  }

  /**
   * Stop a running spinner and mark the item done or failed.
   */
  stopSpinner(label: string, status: 'done' | 'failed', detail?: string): void {
    const item = this.items.get(label);
    if (!item) return;

    // Clear elapsed timer
    if (item._timer) {
      clearInterval(item._timer);
      item._timer = undefined;
    }

    item.status = status;
    if (detail !== undefined) item.detail = detail;

    if (this.isTTY && item.spinner) {
      const text = this._itemText(item);
      if (status === 'done') {
        item.spinner.succeed(chalk.dim(BOX.pipe) + '  ' + text);
      } else {
        item.spinner.fail(chalk.dim(BOX.pipe) + '  ' + text);
      }
      item.spinner = null;
    } else if (!this.isTTY) {
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
  finish(
    totalTime: number,
    totalFindings: number,
    consensusCount: number,
    modelStatuses?: Array<{ name: string; status: string; findings: number; time: string }>,
    severities?: { s0: number; s1: number; s2: number; s3: number },
  ): void {
    this._stopAllSpinners();

    const timeStr = totalTime.toFixed(1) + 's';
    const summary = `${totalFindings} findings, ${consensusCount} consensus`;

    if (this.isTTY) {
      process.stdout.write('\n');
      process.stdout.write(
        chalk.dim(BOX.bottom) + ' ' +
        chalk.bold('Done') + ' in ' + chalk.cyan(timeStr) +
        ' — ' + chalk.yellow(summary) + '\n',
      );
    } else {
      // Rich plain-mode summary for AI orchestrators
      process.stdout.write(`\n=== TRIAGE COMPLETE ===\n`);
      process.stdout.write(`Time: ${timeStr} | Findings: ${totalFindings} | Consensus: ${consensusCount}\n`);
      if (severities) {
        process.stdout.write(`Severity: ${severities.s0} blockers, ${severities.s1} high, ${severities.s2} medium, ${severities.s3} low\n`);
      }
      if (modelStatuses && modelStatuses.length > 0) {
        process.stdout.write(`\nModel Results:\n`);
        for (const m of modelStatuses) {
          process.stdout.write(`  ${m.status === 'done' ? '✓' : '✗'} ${m.name.padEnd(8)} ${m.findings} findings in ${m.time}\n`);
        }
      }
      process.stdout.write(`======================\n`);
    }
  }

  /**
   * Print the very first header line.  Call once at startup.
   */
  printHeader(): void {
    if (this.isTTY) {
      process.stdout.write(
        chalk.dim(BOX.top) + ' ' + chalk.bold.white('triage-ai') +
        ' ' + chalk.dim('v' + VERSION) + '\n',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _itemText(item: TrackedItem): string {
    const sym = this._sym(item.status);

    let labelPart: string;
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

  private _printItem(item: TrackedItem): void {
    process.stdout.write(chalk.dim(BOX.pipe) + '  ' + this._itemText(item) + '\n');
  }

  private _plainItem(item: TrackedItem): void {
    const phase = this._phaseName();
    const sym = item.status === 'done' ? '✓' : item.status === 'failed' ? '✗' : '—';
    const detail = item.detail ? ` (${item.detail})` : '';
    process.stdout.write(`[${phase}] ${item.label} ${sym}${detail}\n`);
  }

  private _sym(status: PhaseItem['status']): string {
    switch (status) {
      case 'done':    return SYM_DONE;
      case 'failed':  return SYM_FAIL;
      case 'skipped': return SYM_SKIP;
      default:        return SYM_PENDING;
    }
  }

  private _phaseName(): string {
    switch (this.currentPhase) {
      case 'intake':     return 'intake';
      case 'team':       return 'team';
      case 'assessment': return 'assess';
      case 'diagnosis':  return 'diag';
      case 'report':     return 'report';
      case 'memory':     return 'memory';
      default:           return 'triage';
    }
  }

  private _phaseNumber(): number {
    switch (this.currentPhase) {
      case 'intake':     return 1;
      case 'team':       return 2;
      case 'assessment': return 3;
      case 'diagnosis':  return 4;
      case 'report':     return 5;
      case 'memory':     return 6;
      default:           return 0;
    }
  }

  private _stopAllSpinners(): void {
    for (const item of this.items.values()) {
      if (item._timer) {
        clearInterval(item._timer);
        item._timer = undefined;
      }
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
export function plainTeamLine(
  results: Array<{ name: string; available: boolean }>,
): string {
  const parts = results.map((r) => `${r.name} ${r.available ? '✓' : '✗'}`);
  return `[team] ${parts.join(', ')}`;
}

/**
 * Format a plain-mode severity breakdown line.
 * Example: "[report] 3 S0, 5 S1, 8 S2, 6 S3"
 */
export function plainReportLine(
  s0: number,
  s1: number,
  s2: number,
  s3: number,
): string {
  return `[report] ${s0} S0, ${s1} S1, ${s2} S2, ${s3} S3`;
}
