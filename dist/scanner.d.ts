/**
 * Repository scanning and context gathering.
 *
 * Handles:
 * - Git diff detection
 * - File discovery based on prompt
 * - Secret redaction
 *
 * TypeScript port of triage_cli/repo_scan.py — faithful port, same logic,
 * same constants, same behavior.
 */
import type { ScanContext, FileContext } from './types.js';
export declare class RepoScanner {
    readonly root: string;
    constructor(root?: string);
    /**
     * Scan repository and return context for models.
     *
     * Returns ScanContext with:
     * - is_git_repo, has_diff, git_diff, git_status, git_log
     * - tree (directory structure)
     * - files: list of { path, content, reason, description }
     * - prompt: original prompt
     * - root: resolved repo root
     */
    scan(diffOnly?: boolean, maxFiles?: number, prompt?: string): ScanContext;
    /** Check if current directory is a git repository. */
    _is_git_repo(): boolean;
    /** Get git status output. */
    _get_git_status(): string;
    /** Get git diff for staged and unstaged changes. */
    _get_git_diff(): string;
    /** Get recent git commits for context. */
    _get_git_log(limit?: number): string;
    /** Get directory structure for orientation. */
    _get_directory_tree(maxDepth?: number, maxEntries?: number): string;
    /** Extract first docstring or comment as file description. */
    _extract_file_description(content: string): string;
    /**
     * Discover relevant files based on prompt and repository structure.
     *
     * Returns list of FileContext objects.
     * Order: explicit paths → explicit dirs → git diff files → keyword search → entrypoints.
     */
    _discover_files(prompt: string, maxFiles: number): FileContext[];
    /** Extract likely file/function/class names from prompt. */
    _extract_keywords(prompt: string): string[];
    /** Find files that match keywords in name or content. */
    _find_files_by_keywords(keywords: string[]): Array<[string, string]>;
    /** Get list of files changed in git diff. */
    _get_diff_file_list(): string[];
    /** Check if file should be included in context. */
    _should_include_file(filePath: string): boolean;
    /** Read file content with size limit and secret redaction. */
    _read_file(filePath: string, maxSize?: number): string | null;
    /** Redact potential secrets from content. */
    _redact_secrets(content: string): string;
    /**
     * Recursively glob a directory for files matching a suffix (e.g. ".py").
     * When recursive=false, only looks in top-level of the directory.
     */
    private _globDir;
}
//# sourceMappingURL=scanner.d.ts.map