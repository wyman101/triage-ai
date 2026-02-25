/**
 * Optional pre-flight quota probes for AI providers.
 *
 * Checks remaining rate limits by making lightweight API calls.
 * Requires provider API keys set as environment variables.
 * All probes are optional — if keys aren't set, probes are silently skipped.
 */
/**
 * Probe Anthropic rate limits via a minimal API call.
 * Requires ANTHROPIC_API_KEY env var.
 */
async function probeAnthropic() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return { provider: 'anthropic', available: false, source: 'none', error: 'ANTHROPIC_API_KEY not set' };
    }
    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1,
                messages: [{ role: 'user', content: 'hi' }],
            }),
            signal: AbortSignal.timeout(10_000),
        });
        return {
            provider: 'anthropic',
            available: true,
            remaining_requests: parseInt(res.headers.get('x-ratelimit-remaining-requests') ?? '', 10) || undefined,
            remaining_tokens: parseInt(res.headers.get('x-ratelimit-remaining-tokens') ?? '', 10) || undefined,
            limit_requests: parseInt(res.headers.get('x-ratelimit-limit-requests') ?? '', 10) || undefined,
            limit_tokens: parseInt(res.headers.get('x-ratelimit-limit-tokens') ?? '', 10) || undefined,
            reset_requests: res.headers.get('x-ratelimit-reset-requests') ?? undefined,
            reset_tokens: res.headers.get('x-ratelimit-reset-tokens') ?? undefined,
            source: 'response_headers',
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { provider: 'anthropic', available: false, source: 'none', error: msg.slice(0, 100) };
    }
}
/**
 * Probe OpenAI rate limits via GET /v1/models (free, zero-token call).
 * Requires OPENAI_API_KEY env var.
 */
async function probeOpenAI() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { provider: 'openai', available: false, source: 'none', error: 'OPENAI_API_KEY not set' };
    }
    try {
        const res = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10_000),
        });
        return {
            provider: 'openai',
            available: true,
            remaining_requests: parseInt(res.headers.get('x-ratelimit-remaining-requests') ?? '', 10) || undefined,
            remaining_tokens: parseInt(res.headers.get('x-ratelimit-remaining-tokens') ?? '', 10) || undefined,
            limit_requests: parseInt(res.headers.get('x-ratelimit-limit-requests') ?? '', 10) || undefined,
            limit_tokens: parseInt(res.headers.get('x-ratelimit-limit-tokens') ?? '', 10) || undefined,
            reset_requests: res.headers.get('x-ratelimit-reset-requests') ?? undefined,
            reset_tokens: res.headers.get('x-ratelimit-reset-tokens') ?? undefined,
            source: 'response_headers',
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { provider: 'openai', available: false, source: 'none', error: msg.slice(0, 100) };
    }
}
/**
 * Gemini has no proactive rate limit API — return unavailable.
 */
function probeGemini() {
    return {
        provider: 'gemini',
        available: false,
        source: 'none',
        error: 'Gemini API provides no proactive rate-limit headers or quota endpoint',
    };
}
/**
 * Run all available quota probes in parallel.
 * Returns results for each provider. Probes without API keys are skipped silently.
 */
export async function runQuotaProbes(models) {
    const probes = [];
    const modelSet = new Set(models.map((m) => m.toLowerCase()));
    if (modelSet.has('claude'))
        probes.push(probeAnthropic());
    if (modelSet.has('codex'))
        probes.push(probeOpenAI());
    if (modelSet.has('gemini'))
        probes.push(Promise.resolve(probeGemini()));
    return Promise.all(probes);
}
/**
 * Format a single quota probe result as a display string.
 */
export function formatQuotaProbe(probe) {
    if (!probe.available) {
        return `${probe.provider}: quota unavailable (${probe.error ?? 'no API key'})`;
    }
    const parts = [probe.provider + ':'];
    if (probe.remaining_requests !== undefined && probe.limit_requests !== undefined) {
        parts.push(`${probe.remaining_requests}/${probe.limit_requests} req/min`);
    }
    if (probe.remaining_tokens !== undefined && probe.limit_tokens !== undefined) {
        parts.push(`${probe.remaining_tokens}/${probe.limit_tokens} tok/min`);
    }
    return parts.length > 1 ? parts.join(' ') : `${probe.provider}: headers available but no rate data`;
}
/**
 * Check if any probe shows critically low quota (< 5 requests or < 1000 tokens).
 */
export function isQuotaCritical(probe) {
    if (!probe.available)
        return false;
    if (probe.remaining_requests !== undefined && probe.remaining_requests < 5)
        return true;
    if (probe.remaining_tokens !== undefined && probe.remaining_tokens < 1000)
        return true;
    return false;
}
//# sourceMappingURL=quota.js.map