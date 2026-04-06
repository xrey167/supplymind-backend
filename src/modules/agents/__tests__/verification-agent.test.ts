import { describe, it, expect } from 'bun:test';
import { buildVerificationPrompt, parseVerificationVerdict } from '../verification-agent';

describe('VerificationAgent', () => {
  it('builds a prompt with task, changes, and approach', () => {
    const prompt = buildVerificationPrompt({
      originalTask: 'Add user authentication',
      filesChanged: ['src/auth/handler.ts', 'src/auth/middleware.ts'],
      approach: 'JWT-based with refresh tokens',
    });
    expect(prompt).toContain('Add user authentication');
    expect(prompt).toContain('src/auth/handler.ts');
    expect(prompt).toContain('adversarial');
  });

  it('parses PASS verdict', () => {
    const output = 'The implementation looks correct.\n\nVERDICT: PASS\nAll checks passed.';
    const verdict = parseVerificationVerdict(output);
    expect(verdict.outcome).toBe('PASS');
  });

  it('parses FAIL verdict', () => {
    const output = 'Found a bug in the auth flow.\n\nVERDICT: FAIL\nMissing token expiry check.';
    const verdict = parseVerificationVerdict(output);
    expect(verdict.outcome).toBe('FAIL');
    expect(verdict.detail).toContain('Missing token expiry');
  });

  it('parses PARTIAL verdict', () => {
    const output = 'Mostly correct but edge cases missing.\n\nVERDICT: PARTIAL\nMissing null check on line 42.';
    const verdict = parseVerificationVerdict(output);
    expect(verdict.outcome).toBe('PARTIAL');
  });

  it('returns UNKNOWN when no verdict found', () => {
    const verdict = parseVerificationVerdict('No verdict mentioned here.');
    expect(verdict.outcome).toBe('UNKNOWN');
  });
});
