import { describe, expect, it } from 'vitest';
import type { AgentSessionHandle } from '@/lib/schemas/chat';
import { validateResume } from '@/lib/server/chat/resume-guard';

const handle: AgentSessionHandle = {
  conversationId: 'c1',
  provider: 'claude',
  providerSessionId: 'sess-1',
  model: 'claude-sonnet-4-6',
  cwd: '/repo',
  lastMessageId: 'm5',
};

const ctx = {
  provider: 'claude',
  model: 'claude-sonnet-4-6',
  cwd: '/repo',
  lastAssistantMessageId: 'm5' as string | null,
};

describe('validateResume', () => {
  it('ok when provider, model, cwd, and cursor all match', () => {
    expect(validateResume(handle, ctx)).toEqual({ ok: true });
  });

  it('no_handle when no session is stored', () => {
    expect(validateResume(null, ctx)).toEqual({ ok: false, reason: 'no_handle' });
  });

  it('model_changed when the model differs', () => {
    expect(validateResume(handle, { ...ctx, model: 'claude-opus-4-7' })).toEqual({
      ok: false,
      reason: 'model_changed',
    });
  });

  it('model_changed when the provider differs (defensive — lookup is provider-keyed)', () => {
    expect(validateResume(handle, { ...ctx, provider: 'codex' })).toEqual({
      ok: false,
      reason: 'model_changed',
    });
  });

  it('cwd_changed when the working directory differs', () => {
    expect(validateResume(handle, { ...ctx, cwd: '/elsewhere' })).toEqual({
      ok: false,
      reason: 'cwd_changed',
    });
  });

  it('missing_cursor when the handle has no lastMessageId', () => {
    expect(validateResume({ ...handle, lastMessageId: null }, ctx)).toEqual({
      ok: false,
      reason: 'missing_cursor',
    });
  });

  it('conversation_advanced when the cursor is stale', () => {
    expect(validateResume(handle, { ...ctx, lastAssistantMessageId: 'm9' })).toEqual({
      ok: false,
      reason: 'conversation_advanced',
    });
    expect(validateResume(handle, { ...ctx, lastAssistantMessageId: null })).toEqual({
      ok: false,
      reason: 'conversation_advanced',
    });
  });
});
