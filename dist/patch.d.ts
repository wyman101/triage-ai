/**
 * Patch application with safety checks.
 *
 * Handles:
 * - Creating git branches before applying
 * - Validating patches apply cleanly (dry-run)
 * - Limiting scope of changes
 */
import type { Patch } from './types.js';
export declare class PatchApplicator {
    private maxFiles;
    private allowedSeverities;
    private appliedFiles;
    constructor(maxFiles?: number, allowedSeverities?: Set<string>);
    /**
     * Apply patches to the repository.
     *
     * Returns the number of patches successfully applied.
     */
    applyPatches(patches: Patch[], createBranch?: boolean, branchName?: string): number;
    /** Create a new git branch before applying patches. */
    _createBranch(branchName?: string): boolean;
    /** Apply a single patch with validation. */
    _applySinglePatch(patch: Patch): boolean;
    /** Validate that the patch is a valid unified diff. */
    _isValidPatch(patch: Patch): boolean;
    /** Check if the patch applies cleanly via `patch --dry-run`. */
    _patchAppliesCleanly(patch: Patch): boolean;
    /** Apply the patch for real via `patch -p1`. */
    _doApplyPatch(patch: Patch): boolean;
    /** Write patch content to a temp file and return its path. */
    private _writeTempPatch;
    /** Remove a temp file, ignoring errors. */
    private _removeTempFile;
    /**
     * Show patches without applying (dry-run display).
     */
    showPatches(patches: Patch[]): string;
}
//# sourceMappingURL=patch.d.ts.map