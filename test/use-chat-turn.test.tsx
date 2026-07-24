import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearActiveTurn,
  persistActiveTurn,
  readPersistedActiveTurns,
  readPersistedTurnFor,
  useChatTurn,
} from '@/hooks/use-chat-turn';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(event: object) {
    act(() => this.onmessage?.({ data: JSON.stringify(event) }));
  }
}

describe('useChatTurn', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    window.sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('start opens the events stream with ?after and accumulates text deltas', () => {
    const { result } = renderHook(() => useChatTurn());
    act(() => result.current.start('t1'));
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe('/api/chat/turns/t1/events?after=0');
    expect(result.current.status).toBe('streaming');
    es.emit({ seq: 1, type: 'text-delta', text: 'Hel' });
    es.emit({ seq: 2, type: 'text-delta', text: 'lo' });
    expect(result.current.streamingText).toBe('Hello');
    expect(result.current.events).toHaveLength(2);
  });

  it('done closes the stream, sets status, fires onDone, clears ONLY its own record', () => {
    const onDone = vi.fn();
    persistActiveTurn({ turnId: 't1', conversationId: 'c1' });
    persistActiveTurn({ turnId: 't2', conversationId: 'c2' }); // another thread's background turn
    const { result } = renderHook(() => useChatTurn({ onDone }));
    act(() => result.current.start('t1'));
    const es = FakeEventSource.instances[0];
    es.emit({ seq: 1, type: 'done', messageId: 'm9' });
    expect(result.current.status).toBe('done');
    expect(onDone).toHaveBeenCalledWith('m9');
    expect(es.closed).toBe(true);
    expect(readPersistedActiveTurns()).toEqual([{ turnId: 't2', conversationId: 'c2' }]);
  });

  it('an error event terminates without reconnect', () => {
    const { result } = renderHook(() => useChatTurn());
    act(() => result.current.start('t1'));
    FakeEventSource.instances[0].emit({ seq: 1, type: 'error', message: 'boom' });
    expect(result.current.status).toBe('error');
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('a connection error mid-stream reconnects with ?after=<last seq>', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useChatTurn());
    act(() => result.current.start('t1'));
    const es = FakeEventSource.instances[0];
    es.emit({ seq: 3, type: 'text-delta', text: 'partial' });
    act(() => {
      es.onerror?.();
      vi.advanceTimersByTime(1100);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].url).toBe('/api/chat/turns/t1/events?after=3');
  });

  it('detach closes without changing status persistence (two-tier cancel)', () => {
    persistActiveTurn({ turnId: 't1', conversationId: 'c1' });
    const { result } = renderHook(() => useChatTurn());
    act(() => result.current.start('t1'));
    act(() => result.current.detach());
    expect(FakeEventSource.instances[0].closed).toBe(true);
    // Persistence untouched — the turn is still running server-side.
    expect(readPersistedActiveTurns()).toEqual([{ turnId: 't1', conversationId: 'c1' }]);
  });

  it('persists a LIST: one slot per conversation, cleared per turn', () => {
    persistActiveTurn({ turnId: 't1', conversationId: 'c1' });
    persistActiveTurn({ turnId: 't2', conversationId: 'c2' });
    expect(readPersistedActiveTurns()).toEqual([
      { turnId: 't1', conversationId: 'c1' },
      { turnId: 't2', conversationId: 'c2' },
    ]);
    // Upsert: a new turn in c1 replaces c1's slot (server lock = one per conv).
    persistActiveTurn({ turnId: 't3', conversationId: 'c1' });
    expect(readPersistedTurnFor('c1')).toEqual({ turnId: 't3', conversationId: 'c1' });
    // null conversation → the most recently started turn (reload jump target).
    expect(readPersistedTurnFor(null)).toEqual({ turnId: 't3', conversationId: 'c1' });
    clearActiveTurn('t3');
    expect(readPersistedTurnFor('c1')).toBeNull();
    clearActiveTurn('t2');
    expect(window.sessionStorage.getItem('sur9e.chat.active-turn')).toBeNull();
  });

  it('read accepts the legacy single-object shape and rejects malformed payloads', () => {
    window.sessionStorage.setItem(
      'sur9e.chat.active-turn',
      JSON.stringify({ turnId: 't1', conversationId: 'c1' }),
    );
    expect(readPersistedActiveTurns()).toEqual([{ turnId: 't1', conversationId: 'c1' }]);
    window.sessionStorage.setItem('sur9e.chat.active-turn', '{"nope":1}');
    expect(readPersistedActiveTurns()).toEqual([]);
    window.sessionStorage.setItem('sur9e.chat.active-turn', '[{"nope":1}]');
    expect(readPersistedActiveTurns()).toEqual([]);
    window.sessionStorage.setItem('sur9e.chat.active-turn', 'not json');
    expect(readPersistedActiveTurns()).toEqual([]);
  });
});
