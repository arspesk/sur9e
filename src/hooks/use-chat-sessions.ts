'use client';

// hooks/use-chat-sessions.ts — TanStack Query wrappers for /api/chat/sessions.
// This module (plus the turn POST in chat-card.tsx) is the ONLY place that
// knows the chat route envelopes — if Plan 1's implemented routes differ,
// fix them here and nowhere else.
//
// NOTE: the committed routes (src/app/api/chat/sessions/route.ts,
// sessions/[id]/route.ts) return `{ sessions }` / `{ session }` — the Plan 3
// doc's literal code used `{ conversations }` / `{ conversation }`, which
// would leave the session switcher empty forever (select always undefined)
// and throw on the first-message-in-a-new-chat path. Fixed here to match the
// committed route shapes ({ sessions } / { session }).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatMessage, Conversation } from '@/lib/schemas/chat';

export const CHAT_SESSIONS_KEY = ['chat', 'sessions'] as const;
export const chatSessionKey = (id: string) => ['chat', 'session', id] as const;

/** Structured chat API error — keeps the setupRequired discriminator (the
 * onboarding-preflight shape from src/server/actions/jobs.ts) that
 * fetchJson's string-only errors would flatten away. */
export class ChatApiError extends Error {
  status: number;
  setupRequired: boolean;
  constructor(status: number, message: string, setupRequired: boolean) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
    this.setupRequired = setupRequired;
  }
}

export async function chatFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // non-JSON error body — fall through to the status line
    }
    throw new ChatApiError(
      res.status,
      String(body.error ?? body.message ?? `${res.status} ${res.statusText}`),
      body.setupRequired === true,
    );
  }
  return res.json() as Promise<T>;
}

export function useChatSessions() {
  return useQuery({
    queryKey: CHAT_SESSIONS_KEY,
    queryFn: () => chatFetch<{ sessions: Conversation[] }>('/api/chat/sessions'),
    select: d => d.sessions,
  });
}

export function useChatSession(id: string | null) {
  return useQuery({
    queryKey: id ? chatSessionKey(id) : ['chat', 'session', 'none'],
    queryFn: () =>
      chatFetch<{ session: Conversation; messages: ChatMessage[] }>(
        `/api/chat/sessions/${encodeURIComponent(id as string)}`,
      ),
    enabled: id != null,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string } = {}) =>
      chatFetch<{ session: Conversation }>('/api/chat/sessions', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY }),
  });
}

export function useRenameSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      chatFetch<{ session: Conversation }>(`/api/chat/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      queryClient.invalidateQueries({ queryKey: chatSessionKey(id) });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      chatFetch<{ ok: boolean }>(`/api/chat/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY }),
  });
}

export function useArchiveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      chatFetch<{ session: Conversation }>(`/api/chat/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived }),
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      queryClient.invalidateQueries({ queryKey: chatSessionKey(id) });
    },
  });
}
