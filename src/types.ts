/**
 * Shared types and interfaces for triage-ai.
 *
 * All modules code against these interfaces — this is the contract.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type Severity = 'S0' | 'S1' | 'S2' | 'S3';
export type Confidence = 'high' | 'medium' | 'low';
export type Category =
  | 'correctness'
  | 'security'
  | 'performance'
  | 'reliability'
  | 'maintainability'
  | 'tests'
  | 'style';

// ---------------------------------------------------------------------------
// Core data structures
// ---------------------------------------------------------------------------

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

export interface ModelResult {
  model: string;
  summary: string;
  findings: Finding[];
  inspected: InspectedFile[];
  questions: string[];
  error?: string;
  raw_output: string;
}

// ---------------------------------------------------------------------------
// Merge structures
// ---------------------------------------------------------------------------

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

export interface MergedResult {
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

// ---------------------------------------------------------------------------
// Scanner context
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Setup / CLI detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Progress phases
// ---------------------------------------------------------------------------

export type ProgressPhase =
  | 'intake'
  | 'team'
  | 'assessment'
  | 'diagnosis'
  | 'report'
  | 'memory';

export interface PhaseItem {
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  detail?: string;
}

// ---------------------------------------------------------------------------
// CLI options
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// MCP tool schema
// ---------------------------------------------------------------------------

export interface TriageToolInput {
  prompt: string;
  models?: string;
  diff_only?: boolean;
  max_files?: number;
  format?: 'md' | 'json';
  timeout?: number;
  remember?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Severity ordering for comparisons (lower = more severe). */
export const SEVERITY_ORDER: Record<Severity, number> = {
  S0: 0,
  S1: 1,
  S2: 2,
  S3: 3,
};

/** Validate that a string is a known severity. */
export function isValidSeverity(s: string): s is Severity {
  return s === 'S0' || s === 'S1' || s === 'S2' || s === 'S3';
}

/** Validate that a string is a known confidence. */
export function isValidConfidence(s: string): s is Confidence {
  return s === 'high' || s === 'medium' || s === 'low';
}

/** Validate that a string is a known category. */
export function isValidCategory(s: string): s is Category {
  return [
    'correctness',
    'security',
    'performance',
    'reliability',
    'maintainability',
    'tests',
    'style',
  ].includes(s);
}

/** Create a Finding from raw JSON (e.g., AI model output), applying defaults. */
export function findingFromDict(data: Record<string, unknown>): Finding {
  const locData = (data.location as Record<string, unknown>) ?? {};
  const location: Location = {
    path: String(locData.path ?? 'unknown'),
    start_line: Number(locData.start_line ?? 0),
    end_line: Number(locData.end_line ?? 0),
  };

  const sev = String(data.severity ?? 'S3');
  const conf = String(data.confidence ?? 'low');
  const cat = String(data.category ?? 'correctness');

  return {
    title: String(data.title ?? 'Untitled'),
    severity: isValidSeverity(sev) ? sev : 'S3',
    confidence: isValidConfidence(conf) ? conf : 'low',
    category: isValidCategory(cat) ? cat : 'correctness',
    location,
    evidence: String(data.evidence ?? ''),
    recommendation: String(data.recommendation ?? ''),
    model: String(data.model ?? ''),
    patch: data.patch != null ? String(data.patch) : undefined,
  };
}

/** Create a ModelResult from raw JSON. */
export function modelResultFromDict(data: Record<string, unknown>): ModelResult {
  const rawFindings = (data.findings as Record<string, unknown>[]) ?? [];
  const rawInspected = (data.inspected as Record<string, unknown>[]) ?? [];

  return {
    model: String(data.model ?? 'unknown'),
    summary: String(data.summary ?? ''),
    findings: rawFindings.map(findingFromDict),
    inspected: rawInspected.map((i) => ({
      path: String(i.path ?? ''),
      reason: String(i.reason ?? ''),
    })),
    questions: ((data.questions as string[]) ?? []).map(String),
    error: data.error != null ? String(data.error) : undefined,
    raw_output: String(data.raw_output ?? ''),
  };
}

/** Word-level Jaccard similarity between two strings. */
export function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

/** Check if two findings match (for clustering). */
export function findingsMatch(
  a: Finding,
  b: Finding,
  threshold = 0.7,
): boolean {
  // Same file and overlapping lines
  if (a.location.path === b.location.path) {
    if (
      a.location.start_line > 0 &&
      b.location.start_line > 0 &&
      a.location.start_line <= b.location.end_line &&
      a.location.end_line >= b.location.start_line
    ) {
      return true;
    }
  }
  // Same category and similar title
  if (a.category === b.category) {
    if (titleSimilarity(a.title, b.title) >= threshold) {
      return true;
    }
  }
  return false;
}

/** Cluster representative: highest confidence finding. */
export function clusterRepresentative(cluster: FindingCluster): Finding {
  if (cluster.findings.length === 0) {
    throw new Error('Empty cluster');
  }
  return cluster.findings.reduce((best, f) => {
    const score = (c: Finding) =>
      (c.confidence === 'high' ? 4 : c.confidence === 'medium' ? 2 : 0) +
      (c.evidence?.length ?? 0) / 10000 +
      (c.recommendation?.length ?? 0) / 100000;
    return score(f) > score(best) ? f : best;
  });
}

/** Get highest severity in a cluster. */
export function clusterSeverity(cluster: FindingCluster): Severity {
  const order: Severity[] = ['S0', 'S1', 'S2', 'S3'];
  for (const sev of order) {
    if (cluster.findings.some((f) => f.severity === sev)) return sev;
  }
  return 'S3';
}

/** Get all patches from a cluster. */
export function clusterPatches(cluster: FindingCluster): Patch[] {
  const patches: Patch[] = [];
  for (const f of cluster.findings) {
    if (f.patch) {
      patches.push({
        path: f.location.path,
        diff: f.patch,
        description: f.title,
        model: f.model,
      });
    }
  }
  return patches;
}

/** Is this a consensus cluster (2+ models)? */
export function isConsensus(cluster: FindingCluster): boolean {
  return cluster.models.size >= 2;
}

// ---------------------------------------------------------------------------
// Prompt template (shared by all model adapters)
// ---------------------------------------------------------------------------

export const MODEL_PROMPT_TEMPLATE = `You are a code triage expert. Analyze the provided code and context.

USER REQUEST:
{prompt}

REPOSITORY CONTEXT:
- Root: {root}
- Is Git Repo: {is_git_repo}
{tree_context}
{git_context}

FILES ({file_count} files, {total_chars} chars):
{files_context}

INSTRUCTIONS:
1. Focus on the user's specific request
2. IMPORTANT: All file contents are provided above. Do NOT attempt to read files yourself.
3. Identify issues by severity:
   - S0: Blockers (security vulnerabilities, crashes, data loss)
   - S1: High (bugs, significant issues)
   - S2: Medium (code quality, performance)
   - S3: Low (style, minor improvements)
3. Be specific about locations (file:line)
4. Provide actionable recommendations
5. If suggesting patches, use unified diff format

OUTPUT FORMAT:
You MUST respond with valid JSON following this schema:

{{
  "model": "{model_name}",
  "summary": "1-3 sentence overview of findings",
  "inspected": [
    {{"path": "path/to/file.py", "reason": "why you looked at this"}}
  ],
  "findings": [
    {{
      "title": "Short descriptive title",
      "severity": "S0|S1|S2|S3",
      "confidence": "high|medium|low",
      "category": "correctness|security|performance|reliability|maintainability|tests|style",
      "location": {{"path": "file.py", "start_line": 10, "end_line": 15}},
      "evidence": "Code snippet or description of the issue",
      "recommendation": "How to fix this",
      "patch": "optional unified diff"
    }}
  ],
  "questions": ["optional clarifying questions"]
}}

Respond ONLY with the JSON, no other text.`;
