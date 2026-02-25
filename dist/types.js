/**
 * Shared types and interfaces for triage-ai.
 *
 * All modules code against these interfaces — this is the contract.
 */
// ---------------------------------------------------------------------------
// Auth / rate-limit error detection (shared across cli.ts and base.ts)
// ---------------------------------------------------------------------------
/** Patterns in stderr/error messages that indicate a CLI auth/quota problem. */
export const AUTH_ERROR_PATTERNS = [
    /not logged in/i,
    /login required/i,
    /please log in/i,
    /authentication (failed|required|error)/i,
    /authenticate/i,
    /unauthorized/i,
    /forbidden/i,
    /api[_\s-]?key/i,
    /ANTHROPIC_API_KEY/,
    /GOOGLE_API_KEY/,
    /OPENAI_API_KEY/,
    /invalid[_\s-]?key/i,
    /missing[_\s-]?key/i,
    /no credentials/i,
    /rate[_\s-]?limit/i,
    /quota exceeded/i,
    /too many requests/i,
    /429/,
    /403/,
    /billing/i,
    /subscription required/i,
];
/**
 * Check an error/stderr string for known auth/quota patterns.
 * Returns a human-readable hint if found, null otherwise.
 */
export function detectAuthError(modelName, text) {
    for (const pattern of AUTH_ERROR_PATTERNS) {
        if (pattern.test(text)) {
            return authHint(modelName, text);
        }
    }
    return null;
}
/** Produce a model-specific auth/rate-limit hint. */
export function authHint(modelName, errorMsg) {
    const lower = errorMsg.toLowerCase();
    const name = modelName.toLowerCase();
    if (/rate.?limit|too many|429|quota/.test(lower)) {
        const others = ['claude', 'gemini', 'codex'].filter((m) => m !== name).join(',');
        return `rate limited — try again later or use --models ${others}`;
    }
    if (/unauthorized|forbidden|403/.test(lower)) {
        return `access denied — check your API key or permissions`;
    }
    if (name === 'claude')
        return 'not authenticated — run: claude auth login';
    if (name === 'gemini')
        return 'not authenticated — run: gemini auth login';
    if (name === 'codex')
        return 'not authenticated — run: codex (or set OPENAI_API_KEY)';
    return 'not authenticated — check API key or run the CLI interactively to log in';
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Severity ordering for comparisons (lower = more severe). */
export const SEVERITY_ORDER = {
    S0: 0,
    S1: 1,
    S2: 2,
    S3: 3,
};
/** Validate that a string is a known severity. */
export function isValidSeverity(s) {
    return s === 'S0' || s === 'S1' || s === 'S2' || s === 'S3';
}
/** Validate that a string is a known confidence. */
export function isValidConfidence(s) {
    return s === 'high' || s === 'medium' || s === 'low';
}
/** Validate that a string is a known category. */
export function isValidCategory(s) {
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
export function findingFromDict(data) {
    const locData = data.location ?? {};
    const location = {
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
export function modelResultFromDict(data) {
    const rawFindings = data.findings ?? [];
    const rawInspected = data.inspected ?? [];
    return {
        model: String(data.model ?? 'unknown'),
        summary: String(data.summary ?? ''),
        findings: rawFindings.map(findingFromDict),
        inspected: rawInspected.map((i) => ({
            path: String(i.path ?? ''),
            reason: String(i.reason ?? ''),
        })),
        questions: (data.questions ?? []).map(String),
        error: data.error != null ? String(data.error) : undefined,
        raw_output: String(data.raw_output ?? ''),
    };
}
/** Word-level Jaccard similarity between two strings. */
export function titleSimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    if (wordsA.size === 0 || wordsB.size === 0)
        return 0;
    let intersection = 0;
    for (const w of wordsA) {
        if (wordsB.has(w))
            intersection++;
    }
    const union = new Set([...wordsA, ...wordsB]).size;
    return intersection / union;
}
/** Check if two findings match (for clustering). */
export function findingsMatch(a, b, threshold = 0.7) {
    // Same file and overlapping lines
    if (a.location.path === b.location.path) {
        if (a.location.start_line > 0 &&
            b.location.start_line > 0 &&
            a.location.start_line <= b.location.end_line &&
            a.location.end_line >= b.location.start_line) {
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
export function clusterRepresentative(cluster) {
    if (cluster.findings.length === 0) {
        throw new Error('Empty cluster');
    }
    return cluster.findings.reduce((best, f) => {
        const score = (c) => (c.confidence === 'high' ? 4 : c.confidence === 'medium' ? 2 : 0) +
            (c.evidence?.length ?? 0) / 10000 +
            (c.recommendation?.length ?? 0) / 100000;
        return score(f) > score(best) ? f : best;
    });
}
/** Get highest severity in a cluster. */
export function clusterSeverity(cluster) {
    const order = ['S0', 'S1', 'S2', 'S3'];
    for (const sev of order) {
        if (cluster.findings.some((f) => f.severity === sev))
            return sev;
    }
    return 'S3';
}
/** Get all patches from a cluster. */
export function clusterPatches(cluster) {
    const patches = [];
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
export function isConsensus(cluster) {
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
You MUST respond with ONLY valid JSON. No markdown, no explanation, no text before or after.
Your entire response must be a single JSON object matching this schema exactly:

\`\`\`json
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
\`\`\`

CRITICAL: Output ONLY the JSON object. Do NOT wrap it in markdown code fences. Do NOT include any text before or after the JSON. Start your response with {{ and end with }}.`;
//# sourceMappingURL=types.js.map