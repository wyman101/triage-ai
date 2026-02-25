/**
 * Optional pre-flight quota probes for AI providers.
 *
 * Checks remaining rate limits by making lightweight API calls.
 * Requires provider API keys set as environment variables.
 * All probes are optional — if keys aren't set, probes are silently skipped.
 */
export interface QuotaProbe {
    provider: string;
    available: boolean;
    remaining_requests?: number;
    remaining_tokens?: number;
    limit_requests?: number;
    limit_tokens?: number;
    reset_requests?: string;
    reset_tokens?: string;
    error?: string;
    source: 'response_headers' | 'none';
}
/**
 * Run all available quota probes in parallel.
 * Returns results for each provider. Probes without API keys are skipped silently.
 */
export declare function runQuotaProbes(models: string[]): Promise<QuotaProbe[]>;
/**
 * Format a single quota probe result as a display string.
 */
export declare function formatQuotaProbe(probe: QuotaProbe): string;
/**
 * Check if any probe shows critically low quota (< 5 requests or < 1000 tokens).
 */
export declare function isQuotaCritical(probe: QuotaProbe): boolean;
//# sourceMappingURL=quota.d.ts.map