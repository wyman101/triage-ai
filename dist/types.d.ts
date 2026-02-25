/**
 * Shared types and interfaces for triage-ai.
 *
 * All modules code against these interfaces — this is the contract.
 */
export type Severity = 'S0' | 'S1' | 'S2' | 'S3';
export type Confidence = 'high' | 'medium' | 'low';
export type Category = 'correctness' | 'security' | 'performance' | 'reliability' | 'maintainability' | 'tests' | 'style';
export interface Location {
    path: string;
    start_line: number;
    end_line: number;
}
export interface Patch {
    path: string;
    diff: string;
    description: string;
    model: string;
}
export interface Finding {
    title: string;
    severity: Severity;
    confidence: Confidence;
    category: Category;
    location: Location;
    evidence: string;
    recommendation: string;
    model: string;
    patch?: string;
}
export interface InspectedFile {
    path: string;
    reason: string;
}
export type ModelStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
export type FailureKind = 'auth' | 'rate_limit' | 'timeout' | 'parse' | 'crash' | 'unknown';
export interface ModelResult {
    model: string;
    summary: string;
    findings: Finding[];
    inspected: InspectedFile[];
    questions: string[];
    error?: string;
    raw_output: string;
    /** Structured run metadata — populated by cli.ts after analyze() returns. */
    status?: ModelStatus;
    elapsed_ms?: number;
    exit_code?: number | null;
    failure_kind?: FailureKind;
    needs_auth?: boolean;
    parsed_as?: 'json' | 'plain_text';
    version?: string | null;
    context_truncated?: boolean;
}
export interface FindingCluster {
    findings: Finding[];
    models: Set<string>;
}
export interface Conflict {
    title: string;
    findings: Finding[];
    conflict_type: 'severity' | 'existence';
    details: string;
}
export interface ModelRunSummary {
    model: string;
    status: ModelStatus;
    elapsed_ms?: number;
    findings_count: number;
    failure_kind?: FailureKind;
    needs_auth?: boolean;
    version?: string | null;
    context_truncated?: boolean;
    parsed_as?: 'json' | 'plain_text';
}
export interface MergedResult {
    model_runs: ModelRunSummary[];
    blockers: FindingCluster[];
    high: FindingCluster[];
    medium: FindingCluster[];
    low: FindingCluster[];
    consensus: FindingCluster[];
    unique_by_model: Record<string, Finding[]>;
    conflicts: Conflict[];
    patches: Patch[];
    questions: string[];
    summaries: Record<string, string>;
}
export interface FileContext {
    path: string;
    content: string;
    reason: string;
    description: string;
}
export interface ScanContext {
    is_git_repo: boolean;
    has_diff: boolean;
    git_diff: string;
    git_status: string;
    git_log: string;
    tree: string;
    files: FileContext[];
    prompt: string;
    root: string;
}
export interface CliTool {
    name: string;
    command: string;
    path: string | null;
    available: boolean;
    install_cmd: string;
    install_url: string;
}
export interface TriageConfig {
    cli_paths: Record<string, string>;
    last_detected: string;
}
export type ProgressPhase = 'intake' | 'team' | 'assessment' | 'diagnosis' | 'report' | 'memory';
export interface PhaseItem {
    label: string;
    status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    detail?: string;
}
export interface CliOptions {
    prompt: string;
    models: string;
    diffOnly: boolean;
    maxFiles: number;
    format: 'md' | 'json';
    out?: string;
    apply: boolean;
    dryRun: boolean;
    timeout: number;
    nice: number;
    resultsDir: string;
    remember: boolean;
    forget: boolean;
    verbose: boolean;
    mcp: boolean;
    setup: boolean;
}
export interface TriageToolInput {
    prompt: string;
    models?: string;
    diff_only?: boolean;
    max_files?: number;
    format?: 'md' | 'json';
    timeout?: number;
    remember?: boolean;
}
/** Patterns in stderr/error messages that indicate a CLI auth/quota problem. */
export declare const AUTH_ERROR_PATTERNS: RegExp[];
/**
 * Check an error/stderr string for known auth/quota patterns.
 * Returns a human-readable hint if found, null otherwise.
 */
export declare function detectAuthError(modelName: string, text: string): string | null;
/** Produce a model-specific auth/rate-limit hint. */
export declare function authHint(modelName: string, errorMsg: string): string;
/** Severity ordering for comparisons (lower = more severe). */
export declare const SEVERITY_ORDER: Record<Severity, number>;
/** Validate that a string is a known severity. */
export declare function isValidSeverity(s: string): s is Severity;
/** Validate that a string is a known confidence. */
export declare function isValidConfidence(s: string): s is Confidence;
/** Validate that a string is a known category. */
export declare function isValidCategory(s: string): s is Category;
/** Create a Finding from raw JSON (e.g., AI model output), applying defaults. */
export declare function findingFromDict(data: Record<string, unknown>): Finding;
/** Create a ModelResult from raw JSON. */
export declare function modelResultFromDict(data: Record<string, unknown>): ModelResult;
/** Word-level Jaccard similarity between two strings. */
export declare function titleSimilarity(a: string, b: string): number;
/** Check if two findings match (for clustering). */
export declare function findingsMatch(a: Finding, b: Finding, threshold?: number): boolean;
/** Cluster representative: highest confidence finding. */
export declare function clusterRepresentative(cluster: FindingCluster): Finding;
/** Get highest severity in a cluster. */
export declare function clusterSeverity(cluster: FindingCluster): Severity;
/** Get all patches from a cluster. */
export declare function clusterPatches(cluster: FindingCluster): Patch[];
/** Is this a consensus cluster (2+ models)? */
export declare function isConsensus(cluster: FindingCluster): boolean;
export declare const MODEL_PROMPT_TEMPLATE = "You are a code triage expert. Analyze the provided code and context.\n\nUSER REQUEST:\n{prompt}\n\nREPOSITORY CONTEXT:\n- Root: {root}\n- Is Git Repo: {is_git_repo}\n{tree_context}\n{git_context}\n\nFILES ({file_count} files, {total_chars} chars):\n{files_context}\n\nINSTRUCTIONS:\n1. Focus on the user's specific request\n2. IMPORTANT: All file contents are provided above. Do NOT attempt to read files yourself.\n3. Identify issues by severity:\n   - S0: Blockers (security vulnerabilities, crashes, data loss)\n   - S1: High (bugs, significant issues)\n   - S2: Medium (code quality, performance)\n   - S3: Low (style, minor improvements)\n3. Be specific about locations (file:line)\n4. Provide actionable recommendations\n5. If suggesting patches, use unified diff format\n\nOUTPUT FORMAT:\nYou MUST respond with ONLY valid JSON. No markdown, no explanation, no text before or after.\nYour entire response must be a single JSON object matching this schema exactly:\n\n```json\n{{\n  \"model\": \"{model_name}\",\n  \"summary\": \"1-3 sentence overview of findings\",\n  \"inspected\": [\n    {{\"path\": \"path/to/file.py\", \"reason\": \"why you looked at this\"}}\n  ],\n  \"findings\": [\n    {{\n      \"title\": \"Short descriptive title\",\n      \"severity\": \"S0|S1|S2|S3\",\n      \"confidence\": \"high|medium|low\",\n      \"category\": \"correctness|security|performance|reliability|maintainability|tests|style\",\n      \"location\": {{\"path\": \"file.py\", \"start_line\": 10, \"end_line\": 15}},\n      \"evidence\": \"Code snippet or description of the issue\",\n      \"recommendation\": \"How to fix this\",\n      \"patch\": \"optional unified diff\"\n    }}\n  ],\n  \"questions\": [\"optional clarifying questions\"]\n}}\n```\n\nCRITICAL: Output ONLY the JSON object. Do NOT wrap it in markdown code fences. Do NOT include any text before or after the JSON. Start your response with {{ and end with }}.";
//# sourceMappingURL=types.d.ts.map