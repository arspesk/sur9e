'use client';

// hooks/use-chat-turn.ts — the SSE consumer for one chat turn.
//
// Native EventSource works here (the events endpoint is GET; the POST that
// creates the turn happens separately in the send flow). Events arrive
// framed `id: <seq>` + `data: <ChatTurnEvent json>`; the server closes the
// stream after done/error. On a transport error while the turn is
// unfinished we reconnect manually with ?after=<last seq> (the route's
// resume contract) rather than relying on EventSource's built-in
// Last-Event-ID retry, so replay is explicit and testable.
//
// Reattach-after-reload mirrors the chat-jobs sessionStorage pattern
// (chat-jobs-store.ts's ACTIVE_JOBS_KEY): the send flow upserts
// {turnId, conversationId} into a LIST — one slot per conversation, since
// the server's per-conversation lock allows at most one running turn each —
// and terminal detection (SSE done/error, the return probe, the background
// watcher) clears exactly its own turn. A single record would let a send in
// thread B orphan thread A's still-running background turn.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatTurnEvent } from '@/lib/schemas/chat';

export type ChatTurnStatus = 'idle' | 'streaming' | 'done' | 'error';

const ACTIVE_TURN_KEY = 'sur9e.chat.active-turn';
const RECONNECT_MS = 1000;

export interface PersistedTurn {
  turnId: string;
  conversationId: string;
}

/** Every persisted in-flight turn, in start order (last = most recent).
 * Accepts the pre-list single-object shape so a record written before the
 * list migration still reattaches. */
export function readPersistedActiveTurns(): PersistedTurn[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_TURN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter(
      (e): e is PersistedTurn =>
        typeof (e as PersistedTurn)?.turnId === 'string' &&
        typeof (e as PersistedTurn)?.conversationId === 'string',
    );
  } catch {
    return [];
  }
}

/** The persisted turn for one conversation — or, when `conversationId` is
 * null (reload before any thread is selected), the most recently started
 * turn, whose thread the reattach effect then jumps to. */
export function readPersistedTurnFor(conversationId: string | null): PersistedTurn | null {
  const turns = readPersistedActiveTurns();
  if (conversationId == null) return turns.at(-1) ?? null;
  return turns.find(t => t.conversationId === conversationId) ?? null;
}

function writePersistedActiveTurns(entries: PersistedTurn[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (entries.length === 0) window.sessionStorage.removeItem(ACTIVE_TURN_KEY);
    else window.sessionStorage.setItem(ACTIVE_TURN_KEY, JSON.stringify(entries));
  } catch {
    // sessionStorage unavailable (private mode, quota) — silent OK
  }
}

/** Upsert this conversation's slot (a conversation runs at most one turn at
 * a time — the server's in-flight lock enforces it). */
export function persistActiveTurn(turn: PersistedTurn): void {
  const rest = readPersistedActiveTurns().filter(t => t.conversationId !== turn.conversationId);
  writePersistedActiveTurns([...rest, turn]);
}

/** Remove exactly this turn's record — keyed by turnId so a stale clear can
 * never drop a NEWER turn persisted for the same conversation. */
export function clearActiveTurn(turnId: string): void {
  writePersistedActiveTurns(readPersistedActiveTurns().filter(t => t.turnId !== turnId));
}

export interface UseChatTurnOptions {
  onDone?: (messageId: string) => void;
  onEvent?: (event: ChatTurnEvent) => void;
}

export interface UseChatTurnResult {
  events: ChatTurnEvent[];
  streamingText: string;
  status: ChatTurnStatus;
  /** Attach to a turn's stream. `after` resumes past seen events (0 = full
   * replay — what reattach-after-reload uses). */
  start: (turnId: string, after?: number) => void;
  /** Close the stream WITHOUT cancelling the server-side turn (two-tier
   * cancellation — explicit Stop posts /cancel separately). */
  detach: () => void;
  /** Detach AND clear local state (events, status, seq cursor) — used when
   * the card switches conversations. Never cancels the server-side turn and
   * never touches the persisted sessionStorage record. */
  reset: () => void;
}

export function useChatTurn(options: UseChatTurnOptions = {}): UseChatTurnResult {
  const [events, setEvents] = useState<ChatTurnEvent[]>([]);
  const [status, setStatus] = useState<ChatTurnStatus>('idle');
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeqRef = useRef(0);
  const statusRef = useRef<ChatTurnStatus>('idle');
  // Latest-callbacks ref so onDone/onEvent never go stale mid-stream.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const detach = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
  }, []);

  const connect = useCallback((turnId: string, after: number) => {
    const es = new EventSource(
      `/api/chat/turns/${encodeURIComponent(turnId)}/events?after=${after}`,
    );
    esRef.current = es;
    es.onmessage = ev => {
      let event: ChatTurnEvent;
      try {
        event = JSON.parse(ev.data) as ChatTurnEvent;
      } catch {
        return; // malformed frame — skip, the seq cursor is untouched
      }
      lastSeqRef.current = event.seq;
      setEvents(prev => [...prev, event]);
      optionsRef.current.onEvent?.(event);
      if (event.type === 'done') {
        statusRef.current = 'done';
        setStatus('done');
        clearActiveTurn(turnId);
        es.close();
        optionsRef.current.onDone?.(event.messageId);
      } else if (event.type === 'error') {
        statusRef.current = 'error';
        setStatus('error');
        clearActiveTurn(turnId);
        es.close();
      }
    };
    es.onerror = () => {
      es.close();
      if (statusRef.current !== 'streaming') return;
      retryRef.current = setTimeout(() => connect(turnId, lastSeqRef.current), RECONNECT_MS);
    };
  }, []);

  const start = useCallback(
    (turnId: string, after = 0) => {
      detach();
      lastSeqRef.current = after;
      setEvents([]);
      statusRef.current = 'streaming';
      setStatus('streaming');
      connect(turnId, after);
    },
    [connect, detach],
  );

  const reset = useCallback(() => {
    detach();
    lastSeqRef.current = 0;
    setEvents([]);
    statusRef.current = 'idle';
    setStatus('idle');
  }, [detach]);

  // Unmount detaches only — closing the tab must NOT kill the turn.
  useEffect(() => () => detach(), [detach]);

  const streamingText = useMemo(
    () => events.map(e => (e.type === 'text-delta' ? e.text : '')).join(''),
    [events],
  );

  return { events, streamingText, status, start, detach, reset };
}
