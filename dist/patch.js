/**
 * Patch application with safety checks.
 *
 * Handles:
 * - Creating git branches before applying
 * - Validating patches apply cleanly (dry-run)
 * - Limiting scope of changes
 */
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
// ---------------------------------------------------------------------------
// PatchApplicator
// ---------------------------------------------------------------------------
export class PatchApplicator {
    maxFiles;
    allowedSeverities;
    appliedFiles;
    constructor(maxFiles = 5, allowedSeverities = new Set(['S0', 'S1'])) {
        this.maxFiles = maxFiles;
        this.allowedSeverities = allowedSeverities;
        this.appliedFiles = new Set();
    }
    /**
     * Apply patches to the repository.
     *
     * Returns the number of patches successfully applied.
     */
    applyPatches(patches, createBranch = true, branchName) {
        if (patches.length === 0)
            return 0;
        // Create branch if requested
        if (createBranch) {
            if (!this._createBranch(branchName)) {
                console.log('Warning: Failed to create branch, applying to current branch');
            }
        }
        let applied = 0;
        for (const patch of patches) {
            // Check file limit
            if (this.appliedFiles.size >= this.maxFiles) {
                console.log(`Reached max file limit (${this.maxFiles}), stopping`);
                break;
            }
            if (this._applySinglePatch(patch)) {
                applied++;
                this.appliedFiles.add(patch.path);
            }
        }
        return applied;
    }
    /** Create a new git branch before applying patches. */
    _createBranch(branchName) {
        if (!branchName) {
            const now = new Date();
            const ts = now.getFullYear().toString() +
                String(now.getMonth() + 1).padStart(2, '0') +
                String(now.getDate()).padStart(2, '0') +
                '_' +
                String(now.getHours()).padStart(2, '0') +
                String(now.getMinutes()).padStart(2, '0') +
                String(now.getSeconds()).padStart(2, '0');
            branchName = `triage/${ts}`;
        }
        try {
            execSync(`git checkout -b ${branchName}`, {
                stdio: 'pipe',
                timeout: 10_000,
            });
            console.log(`Created branch: ${branchName}`);
            return true;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`Failed to create branch: ${msg}`);
            return false;
        }
    }
    /** Apply a single patch with validation. */
    _applySinglePatch(patch) {
        if (!this._isValidPatch(patch)) {
            console.log(`Invalid patch format for ${patch.path}`);
            return false;
        }
        if (!this._patchAppliesCleanly(patch)) {
            console.log(`Patch does not apply cleanly to ${patch.path}`);
            return false;
        }
        return this._doApplyPatch(patch);
    }
    /** Validate that the patch is a valid unified diff. */
    _isValidPatch(patch) {
        if (!patch.diff)
            return false;
        const lines = patch.diff.split('\n');
        const hasMinus = lines.some((l) => l.startsWith('---') || l.startsWith('-'));
        const hasPlus = lines.some((l) => l.startsWith('+++') || l.startsWith('+'));
        const hasHunk = lines.some((l) => l.startsWith('@@'));
        return hasMinus && hasPlus && hasHunk;
    }
    /** Check if the patch applies cleanly via `patch --dry-run`. */
    _patchAppliesCleanly(patch) {
        const tmpFile = this._writeTempPatch(patch.diff);
        if (!tmpFile)
            return false;
        try {
            execSync(`patch --dry-run -p1 -i ${tmpFile}`, {
                stdio: 'pipe',
                timeout: 10_000,
            });
            return true;
        }
        catch {
            return false;
        }
        finally {
            this._removeTempFile(tmpFile);
        }
    }
    /** Apply the patch for real via `patch -p1`. */
    _doApplyPatch(patch) {
        const tmpFile = this._writeTempPatch(patch.diff);
        if (!tmpFile)
            return false;
        try {
            execSync(`patch -p1 -i ${tmpFile}`, {
                stdio: 'pipe',
                timeout: 10_000,
            });
            console.log(`Applied patch to ${patch.path}`);
            return true;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`Failed to apply patch: ${msg}`);
            return false;
        }
        finally {
            this._removeTempFile(tmpFile);
        }
    }
    /** Write patch content to a temp file and return its path. */
    _writeTempPatch(diff) {
        const name = join(tmpdir(), `triage-${randomBytes(6).toString('hex')}.patch`);
        try {
            writeFileSync(name, diff, 'utf-8');
            return name;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`Error writing temp patch: ${msg}`);
            return null;
        }
    }
    /** Remove a temp file, ignoring errors. */
    _removeTempFile(path) {
        try {
            unlinkSync(path);
        }
        catch {
            // ignore
        }
    }
    /**
     * Show patches without applying (dry-run display).
     */
    showPatches(patches) {
        const lines = [];
        for (let i = 0; i < patches.length; i++) {
            const patch = patches[i];
            lines.push(`=== Patch ${i + 1}: ${patch.path} ===`);
            lines.push(`Model: ${patch.model}`);
            lines.push(`Description: ${patch.description}`);
            lines.push('');
            lines.push(patch.diff);
            lines.push('');
        }
        return lines.join('\n');
    }
}
//# sourceMappingURL=patch.js.map