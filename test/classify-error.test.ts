import { describe, expect, it } from 'vitest';
import { classifyProviderError, isRetryable } from '../cli/classify-error.mjs';

describe('classifyProviderError', () => {
  it.each([
    ["There's an issue with the selected model", 'model_not_found'],
    [
      'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"model: claude-opus-9 not found"}}',
      'model_not_found',
    ],
    [
      '{"type":"error","error":{"type":"rate_limit_error","message":"Your account has hit a rate limit."}}',
      'rate_limit',
    ],
    ['{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', 'overloaded'],
    ["You've hit your session limit. It resets at 3pm", 'quota'],
    ['Credit balance is too low', 'quota'],
    ['OAuth token revoked. Please run /login', 'auth'],
    ['Not logged in. Please run `claude login`', 'auth'],
    ['claude: command not found', 'install'],
    [
      '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}',
      'context_overflow',
    ],
    [
      '{"type":"error","error":{"type":"invalid_request_error","message":"max_output_tokens exceeds limit"}}',
      'context_overflow',
    ],
    ['some totally unrelated crash', 'unknown'],
  ])('claude: %s → %s', (text, expected) => {
    expect(classifyProviderError('claude', text)).toBe(expected);
  });

  it.each([
    [
      "unexpected status 400 Bad Request: The requested model 'gpt-9' does not exist.",
      'model_not_found',
    ],
    [
      // ChatGPT-account wording, observed live on codex-cli 0.133.0
      '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-nonexistent-99\' model is not supported when using Codex with a ChatGPT account."}}',
      'model_not_found',
    ],
    ['exceeded retry limit, last status: 429 Too Many Requests', 'rate_limit'],
    ['Selected model is at capacity. Please try a different model.', 'overloaded'],
    ["You've hit your usage limit. Switch to another model now, or try again at 6pm.", 'quota'],
    ['Your workspace is out of credits.', 'quota'],
    ['unexpected status 401 Unauthorized: token expired', 'auth'],
    ['Codex ran out of room in the model’s context window.', 'context_overflow'],
    ['codex: command not found', 'install'],
  ])('codex: %s → %s', (text, expected) => {
    expect(classifyProviderError('codex', text)).toBe(expected);
  });

  it.each([
    ['Model not found: anthropic/claude-99. Try: opencode models', 'model_not_found'],
    ['ProviderModelNotFoundError', 'model_not_found'],
    ['Rate Limited — too many requests', 'rate_limit'],
    ['Provider is overloaded', 'overloaded'],
    ['usage limit reached. It will reset in 2 hours', 'quota'],
    ['ProviderAuthError: run opencode auth login', 'auth'],
    ['ContextOverflowError', 'context_overflow'],
    ['opencode: command not found', 'install'],
  ])('opencode: %s → %s', (text, expected) => {
    expect(classifyProviderError('opencode', text)).toBe(expected);
  });

  it('spawn ENOENT classifies as install for any provider', () => {
    expect(classifyProviderError('codex', 'spawn codex ENOENT')).toBe('install');
  });
  it('unknown provider id falls back to the shared signature table', () => {
    expect(classifyProviderError('something-else', 'rate limit hit')).toBe('rate_limit');
  });
});

describe('isRetryable', () => {
  it.each([
    ['model_not_found', true],
    ['rate_limit', true],
    ['overloaded', true],
    ['quota', true],
    ['install', true],
    ['auth', false],
    ['context_overflow', false],
    ['unknown', false],
  ])('%s → %s', (category, expected) => {
    expect(isRetryable(category)).toBe(expected);
  });
});
