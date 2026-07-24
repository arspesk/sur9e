import { describe, expect, it } from 'vitest';
import {
  AgentSessionHandle,
  ChatMessage,
  ChatRole,
  ChatTurnEvent,
  Conversation,
} from '@/lib/schemas/chat';

describe('chat schemas', () => {
  it('ChatRole accepts user/assistant and rejects system', () => {
    expect(ChatRole.parse('user')).toBe('user');
    expect(ChatRole.parse('assistant')).toBe('assistant');
    expect(ChatRole.safeParse('system').success).toBe(false);
  });

  it('Conversation parses a full row and rejects a missing title', () => {
    const c = Conversation.parse({
      id: 'c1',
      title: 'New chat',
      mode: null,
      archived: false,
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    });
    expect(c.mode).toBeNull();
    expect(Conversation.safeParse({ id: 'c1', archived: false, mode: null }).success).toBe(false);
  });

  it('ChatMessage parses with events null or array', () => {
    const base = {
      id: 'm1',
      conversationId: 'c1',
      role: 'assistant',
      content: 'hi',
      position: 0,
      createdAt: '2026-07-18T00:00:00.000Z',
    };
    expect(ChatMessage.parse({ ...base, events: null }).events).toBeNull();
    expect(ChatMessage.parse({ ...base, events: [{ any: 'thing' }] }).events).toHaveLength(1);
    expect(ChatMessage.safeParse({ ...base, events: 'nope' }).success).toBe(false);
  });

  it('AgentSessionHandle parses with nullable lastMessageId', () => {
    const h = AgentSessionHandle.parse({
      conversationId: 'c1',
      provider: 'claude',
      providerSessionId: 's1',
      model: 'claude-sonnet-4-6',
      cwd: '/tmp/x',
      lastMessageId: null,
    });
    expect(h.lastMessageId).toBeNull();
  });

  it('ChatTurnEvent discriminates on type', () => {
    expect(ChatTurnEvent.parse({ seq: 1, type: 'text-delta', text: 'hi' }).type).toBe('text-delta');
    expect(ChatTurnEvent.parse({ seq: 2, type: 'thinking', text: 'hmm' }).type).toBe('thinking');
    expect(
      ChatTurnEvent.parse({ seq: 3, type: 'tool', name: 'WebFetch', status: 'start' }).type,
    ).toBe('tool');
    expect(ChatTurnEvent.parse({ seq: 4, type: 'stage', label: 'init' }).type).toBe('stage');
    expect(
      ChatTurnEvent.parse({ seq: 5, type: 'ui', action: 'navigate', path: '/report/3' }).type,
    ).toBe('ui');
    expect(
      ChatTurnEvent.parse({ seq: 6, type: 'confirm', token: 't', summary: 's', meta: 'm' }).type,
    ).toBe('confirm');
    expect(
      ChatTurnEvent.parse({ seq: 7, type: 'confirm-resolved', token: 't', outcome: 'approved' })
        .type,
    ).toBe('confirm-resolved');
    expect(
      ChatTurnEvent.parse({ seq: 7, type: 'confirm-resolved', token: 't', outcome: 'cancelled' })
        .type,
    ).toBe('confirm-resolved');
    expect(
      ChatTurnEvent.parse({ seq: 7, type: 'confirm-resolved', token: 't', outcome: 'expired' })
        .type,
    ).toBe('confirm-resolved');
    expect(
      ChatTurnEvent.parse({
        seq: 8,
        type: 'usage',
        costUsd: 0.01,
        inputTokens: 10,
        outputTokens: 5,
        model: 'claude-sonnet-4-6',
      }).type,
    ).toBe('usage');
    expect(
      (
        ChatTurnEvent.parse({
          seq: 9,
          type: 'usage',
          costUsd: null,
          inputTokens: null,
          outputTokens: null,
          model: null,
        }) as Extract<ChatTurnEvent, { type: 'usage' }>
      ).costUsd,
    ).toBeNull();
    expect(ChatTurnEvent.parse({ seq: 10, type: 'error', message: 'boom' }).type).toBe('error');
    expect(ChatTurnEvent.parse({ seq: 11, type: 'done', messageId: 'm9' }).type).toBe('done');
  });

  it('ChatTurnEvent rejects unknown types, missing seq, missing done.messageId', () => {
    expect(ChatTurnEvent.safeParse({ seq: 1, type: 'mystery' }).success).toBe(false);
    expect(ChatTurnEvent.safeParse({ type: 'stage', label: 'x' }).success).toBe(false);
    expect(ChatTurnEvent.safeParse({ seq: 1, type: 'done' }).success).toBe(false);
  });
});
