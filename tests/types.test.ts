import { describe, it, expect } from 'vitest';
import {
  detectAuthError,
  authHint,
  isValidSeverity,
  isValidConfidence,
  isValidCategory,
  findingsMatch,
  titleSimilarity,
  type Finding,
} from '../src/types.js';

describe('detectAuthError', () => {
  it('detects authentication failures', () => {
    expect(detectAuthError('claude', 'not logged in')).toContain('not authenticated');
    expect(detectAuthError('gemini', 'login required')).toContain('not authenticated');
    expect(detectAuthError('codex', 'OPENAI_API_KEY missing')).toContain('not authenticated');
  });

  it('detects rate limiting', () => {
    const hint = detectAuthError('claude', 'rate limited');
    expect(hint).toContain('rate limited');
  });

  it('returns null for normal output', () => {
    expect(detectAuthError('claude', 'analysis complete')).toBeNull();
  });
});

describe('authHint', () => {
  it('gives model-specific auth hints', () => {
    expect(authHint('claude', 'auth error')).toContain('claude auth login');
    expect(authHint('gemini', 'auth error')).toContain('gemini auth login');
    expect(authHint('codex', 'auth error')).toContain('OPENAI_API_KEY');
  });

  it('gives rate limit hint with alternative models', () => {
    const hint = authHint('claude', 'rate limit exceeded');
    expect(hint).toContain('rate limited');
    expect(hint).toContain('gemini,codex');
  });
});

describe('validators', () => {
  it('validates severities', () => {
    expect(isValidSeverity('S0')).toBe(true);
    expect(isValidSeverity('S1')).toBe(true);
    expect(isValidSeverity('S4')).toBe(false);
    expect(isValidSeverity('high')).toBe(false);
  });

  it('validates confidence', () => {
    expect(isValidConfidence('high')).toBe(true);
    expect(isValidConfidence('medium')).toBe(true);
    expect(isValidConfidence('S1')).toBe(false);
  });

  it('validates categories', () => {
    expect(isValidCategory('security')).toBe(true);
    expect(isValidCategory('correctness')).toBe(true);
    expect(isValidCategory('unknown')).toBe(false);
  });
});

describe('titleSimilarity', () => {
  it('returns 1 for identical titles', () => {
    expect(titleSimilarity('foo bar', 'foo bar')).toBe(1);
  });

  it('returns 0 for completely different titles', () => {
    expect(titleSimilarity('foo bar', 'baz qux')).toBe(0);
  });

  it('handles partial overlap', () => {
    const sim = titleSimilarity('missing auth check', 'auth check is missing');
    expect(sim).toBeGreaterThan(0.5);
  });
});

describe('findingsMatch', () => {
  const makeFinding = (overrides: Partial<Finding>): Finding => ({
    title: 'Test finding',
    severity: 'S1',
    confidence: 'high',
    category: 'correctness',
    location: { path: 'test.ts', start_line: 10, end_line: 20 },
    evidence: 'test evidence',
    recommendation: 'fix it',
    model: 'claude',
    ...overrides,
  });

  it('matches findings in same file with overlapping lines', () => {
    const a = makeFinding({ location: { path: 'foo.ts', start_line: 10, end_line: 20 } });
    const b = makeFinding({ location: { path: 'foo.ts', start_line: 15, end_line: 25 } });
    expect(findingsMatch(a, b)).toBe(true);
  });

  it('does not match findings in different files with no title overlap', () => {
    const a = makeFinding({ title: 'A', location: { path: 'a.ts', start_line: 1, end_line: 5 } });
    const b = makeFinding({ title: 'B', location: { path: 'b.ts', start_line: 1, end_line: 5 } });
    expect(findingsMatch(a, b)).toBe(false);
  });
});
