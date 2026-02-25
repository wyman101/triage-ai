/**
 * Triage progress display — rich (TTY) and plain (CI/piped) modes.
 *
 * Rich TTY mode uses chalk colours and ora spinners, rendered with
 * box-drawing characters.  During the assessment phase, a bordered
 * panel shows all models at once with in-place updates.
 *
 * Plain mode emits simple bracketed lines so CI logs stay readable.
 */

import chalk, { type ChalkInstance } from 'chalk';
import ora, { type Ora } from 'ora';
import type { ProgressPhase, PhaseItem } from './types.js';
import { VERSION } from './version.js';

// ---------------------------------------------------------------------------
// Box-drawing helpers
// ---------------------------------------------------------------------------

const BOX = {
  top:    '┌',
  mid:    '├',
  pipe:   '│',
  bottom: '└',
  dot:    '·',
  hLine:  '─',
  tl:     '╭',
  tr:     '╮',
  bl:     '╰',
  br:     '╯',
} as const;

// ---------------------------------------------------------------------------
// Spinner frames (braille dots)
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

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
// Configurable heartbeat interval (env override for different orchestrators)
// ---------------------------------------------------------------------------

const HEARTBEAT_MS = parseInt(process.env.TRIAGE_HEARTBEAT_MS ?? '', 10) || 15_000;

// ---------------------------------------------------------------------------
// Assessment panel constants
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 48;  // Inner content width (between border chars)
const PANEL_UPDATE_MS = 80;  // Spinner animation speed

// ---------------------------------------------------------------------------
// TriageProgress
// ---------------------------------------------------------------------------

export class TriageProgress {
  private readonly isTTY: boolean;
  private currentPhase: ProgressPhase | null = null;
  private items: Map<string, TrackedItem> = new Map();

  // Assessment panel state (TTY only)
  private _panelActive = false;
  private _panelRendered = false;
  private _panelLineCount = 0;
  private _panelTimer?: ReturnType<typeof setInterval>;
  private _spinnerFrame = 0;
  private _panelTimeoutSec = 300;

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
    this._stopPanel();
    this._stopAllSpinners();
    this.items.clear();

    this.currentPhase = phase;

    if (this.isTTY) {
      process.stdout.write('\n');
      const colour = phaseColour(phase);
      process.stdout.write(chalk.dim(BOX.mid) + ' ' + colour.bold(title) + '\n');
    } else {
      // Plain mode: machine-parseable phase header with fraction and phase ID
      const num = this._phaseNumber();
      const total = 6;
      process.stdout.write(`\n[phase:${num}/${total}] ${this._phaseName()} — ${title}\n`);
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

    if (this.isTTY && !this._panelActive) {
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

    if (item.spinner || this._panelActive) {
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
   *
   * During assessment phase in TTY mode, items are rendered in a bordered
   * panel instead of individual ora spinners.
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
    if (timeoutSec) this._panelTimeoutSec = timeoutSec;

    // ---- Assessment panel mode (TTY only) ----
    if (this.isTTY && this.currentPhase === 'assessment') {
      if (!this._panelActive) {
        this._panelActive = true;
        this._panelRendered = false;
        // Hide cursor for clean panel rendering
        process.stdout.write('\x1b[?25l');
      }
      // Start the panel animation timer (once)
      if (!this._panelTimer) {
        this._panelTimer = setInterval(() => {
          this._spinnerFrame = (this._spinnerFrame + 1) % SPINNER_FRAMES.length;
          this._renderPanel();
        }, PANEL_UPDATE_MS);
      }
      this._renderPanel();
      return;
    }

    // ---- Standard ora spinner mode (TTY, non-assessment) ----
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
      // ---- Plain mode (non-TTY) ----
      process.stdout.write(`[${this._phaseName()}] ${label}…\n`);

      // Periodic heartbeat for non-TTY (CI / AI orchestrators)
      item._timer = setInterval(() => {
        const elapsed = Math.round((Date.now() - item._startTime!) / 1000);
        const warnStr = timeoutSec && elapsed > timeoutSec * 0.8
          ? ' (approaching timeout)' : '';
        process.stdout.write(`[${this._phaseName()}] ${label}… ${elapsed}s${warnStr}\n`);
      }, HEARTBEAT_MS);
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

    // ---- Panel mode ----
    if (this._panelActive) {
      this._renderPanel();
      // If all items are done/failed, finalize the panel
      const allDone = [...this.items.values()].every(
        (i) => i.status === 'done' || i.status === 'failed' || i.status === 'skipped',
      );
      if (allDone) {
        this._stopPanel();
      }
      return;
    }

    // ---- Standard ora spinner ----
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
    modelStatuses?: Array<{ name: string; status: string; findings: number; time: string; parsed_as?: string }>,
    severities?: { s0: number; s1: number; s2: number; s3: number },
    contextTruncated?: boolean,
  ): void {
    this._stopPanel();
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
      if (contextTruncated) {
        process.stdout.write(`⚠ Context was truncated — analysis may be incomplete for large files\n`);
      }
      if (severities) {
        process.stdout.write(`Severity: ${severities.s0} blockers, ${severities.s1} high, ${severities.s2} medium, ${severities.s3} low\n`);
      }
      if (modelStatuses && modelStatuses.length > 0) {
        process.stdout.write(`\nModel Results:\n`);
        for (const m of modelStatuses) {
          const sym = m.status === 'done' ? '✓' : '✗';
          const parseNote = m.parsed_as === 'plain_text' ? ' (prose)' : '';
          process.stdout.write(`  ${sym} ${m.name.padEnd(8)} ${m.findings} findings in ${m.time}${parseNote}\n`);
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
    } else {
      process.stdout.write(`=== triage-ai v${VERSION} ===\n`);
    }
  }

  // -------------------------------------------------------------------------
  // Assessment panel rendering (TTY only)
  // -------------------------------------------------------------------------

  /**
   * Render the assessment panel — a bordered box showing all model statuses.
   * Uses ANSI cursor movement to redraw in-place.
   *
   * ╭──────────────────────────────────────────────────╮
   * │  ⠋ Claude     examining codebase…          32s  │
   * │  ✓ Gemini     14 findings                 38.2s │
   * │  ⠋ Codex      examining codebase…          35s  │
   * ╰──────────────────────────────────────────────────╯
   */
  private _renderPanel(): void {
    const items = [...this.items.values()];
    if (items.length === 0) return;

    // Lines: top border + one per model + bottom border
    const lineCount = items.length + 2;

    // If already rendered, move cursor up to overwrite
    if (this._panelRendered) {
      process.stdout.write(`\x1b[${this._panelLineCount}A`);
    }

    const frame = SPINNER_FRAMES[this._spinnerFrame];
    const topBorder = chalk.dim(BOX.pipe) + '  ' + chalk.dim(BOX.tl + BOX.hLine.repeat(PANEL_WIDTH) + BOX.tr);
    const botBorder = chalk.dim(BOX.pipe) + '  ' + chalk.dim(BOX.bl + BOX.hLine.repeat(PANEL_WIDTH) + BOX.br);

    // Clear line and write top border
    process.stdout.write('\x1b[2K' + topBorder + '\n');

    for (const item of items) {
      let sym: string;
      let nameStr: string;
      let detailStr: string;
      let timeStr: string;

      const elapsed = item._startTime
        ? ((Date.now() - item._startTime) / 1000).toFixed(1) + 's'
        : '';

      switch (item.status) {
        case 'running': {
          sym = chalk.yellow(frame);
          nameStr = chalk.white(item.label);
          detailStr = chalk.dim(item.detail ?? 'running');
          const warn = this._panelTimeoutSec && item._startTime &&
            (Date.now() - item._startTime) / 1000 > this._panelTimeoutSec * 0.8
            ? chalk.red(' ⚠') : '';
          timeStr = chalk.dim(elapsed) + warn;
          break;
        }
        case 'done':
          sym = chalk.green('✓');
          nameStr = chalk.green(item.label);
          detailStr = chalk.white(item.detail ?? 'done');
          timeStr = '';  // elapsed is in the detail
          break;
        case 'failed':
          sym = chalk.red('✗');
          nameStr = chalk.red(item.label);
          detailStr = chalk.red(item.detail ?? 'failed');
          timeStr = '';
          break;
        default:
          sym = chalk.dim('·');
          nameStr = chalk.dim(item.label);
          detailStr = chalk.dim('waiting');
          timeStr = '';
      }

      // Build the line content (plain, no ANSI) for padding calculation
      const namePad = item.label.padEnd(12);
      const plainDetail = item.detail ?? (item.status === 'running' ? 'running' : item.status);
      const plainTime = item.status === 'running' ? elapsed : '';
      const plainContent = `  ${' '} ${namePad}${plainDetail}`;
      // Available space for time = PANEL_WIDTH - plainContent.length - 2 (right padding)
      const timeSpace = Math.max(0, PANEL_WIDTH - plainContent.length - plainTime.length - 2);

      const content = `  ${sym} ${item.status === 'done' ? chalk.green(namePad) : item.status === 'failed' ? chalk.red(namePad) : chalk.white(namePad)}${detailStr}${' '.repeat(timeSpace)}${timeStr}  `;

      // Pad to exact PANEL_WIDTH + trim for consistent border alignment
      const line = chalk.dim(BOX.pipe) + '  ' + chalk.dim('│') + content + chalk.dim('│');
      process.stdout.write('\x1b[2K' + line + '\n');
    }

    process.stdout.write('\x1b[2K' + botBorder + '\n');

    this._panelLineCount = lineCount;
    this._panelRendered = true;
  }

  /**
   * Stop the panel animation and show cursor.
   */
  private _stopPanel(): void {
    if (this._panelTimer) {
      clearInterval(this._panelTimer);
      this._panelTimer = undefined;
    }
    if (this._panelActive) {
      // Final render to show completed state
      this._renderPanel();
      this._panelActive = false;
      // Show cursor again
      process.stdout.write('\x1b[?25h');
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
    const sym = item.status === 'done' ? '✓'
      : item.status === 'failed' ? '✗'
      : item.status === 'running' ? '»'
      : '—';
    const detail = item.detail ? ` (${item.detail})` : '';
    // Include elapsed time as a separate field when available
    const elapsed = item._startTime
      ? ` elapsed=${((Date.now() - item._startTime) / 1000).toFixed(1)}s`
      : '';
    process.stdout.write(`[${phase}] ${item.label} ${sym}${detail}${elapsed}\n`);
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
