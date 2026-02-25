import { describe, it, expect } from 'vitest';
import { MergeEngine, mergedResultToDict } from '../src/merge.js';
import type { ModelResult } from '../src/types.js';

describe('MergeEngine', () => {
  const engine = new MergeEngine();

  it('merges results from multiple models', () => {
    const results: ModelResult[] = [
      {
        model: 'claude',
        summary: 'Found issues',
        findings: [
          {
            title: 'SQL injection',
            severity: 'S0',
            confidence: 'high',
            category: 'security',
            location: { path: 'app.ts', start_line: 10, end_line: 15 },
            evidence: 'unsanitized input',
            recommendation: 'use parameterized queries',
            model: 'claude',
          },
        ],
        inspected: [],
        questions: [],
        raw_output: '',
        status: 'succeeded',
        elapsed_ms: 5000,
        parsed_as: 'json',
      },
    ];

    const merged = engine.merge(results);
    expect(merged.blockers).toHaveLength(1);
    expect(merged.model_runs).toHaveLength(1);
    expect(merged.model_runs[0].model).toBe('claude');
    expect(merged.model_runs[0].status).toBe('succeeded');
    expect(merged.model_runs[0].findings_count).toBe(1);
  });

  it('detects consensus when 2+ models agree', () => {
    const results: ModelResult[] = [
      {
        model: 'claude',
        summary: 'Found XSS',
        findings: [
          {
            title: 'XSS vulnerability in input handler',
            severity: 'S1',
            confidence: 'high',
            category: 'security',
            location: { path: 'handler.ts', start_line: 20, end_line: 30 },
            evidence: 'unescaped html',
            recommendation: 'escape output',
            model: 'claude',
          },
        ],
        inspected: [],
        questions: [],
        raw_output: '',
      },
      {
        model: 'gemini',
        summary: 'Found XSS',
        findings: [
          {
            title: 'XSS vulnerability in input handler',
            severity: 'S1',
            confidence: 'high',
            category: 'security',
            location: { path: 'handler.ts', start_line: 22, end_line: 28 },
            evidence: 'unescaped user input',
            recommendation: 'sanitize',
            model: 'gemini',
          },
        ],
        inspected: [],
        questions: [],
        raw_output: '',
      },
    ];

    const merged = engine.merge(results);
    expect(merged.consensus).toHaveLength(1);
    expect(merged.consensus[0].models.size).toBe(2);
  });
});

describe('mergedResultToDict', () => {
  it('includes model_runs in serialized output', () => {
    const engine = new MergeEngine();
    const results: ModelResult[] = [
      {
        model: 'claude',
        summary: 'test',
        findings: [],
        inspected: [],
        questions: [],
        raw_output: '',
        status: 'succeeded',
        elapsed_ms: 1000,
        parsed_as: 'json',
        context_truncated: true,
      },
    ];

    const merged = engine.merge(results);
    const dict = mergedResultToDict(merged);

    expect(dict).toHaveProperty('model_runs');
    const runs = dict.model_runs as Array<Record<string, unknown>>;
    expect(runs).toHaveLength(1);
    expect(runs[0].model).toBe('claude');
    expect(runs[0].context_truncated).toBe(true);
  });
});
