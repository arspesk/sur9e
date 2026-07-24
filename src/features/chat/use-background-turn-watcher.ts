'use client';

// Polls every persisted active turn while nobody is attached to its stream:
// chat closed, or a different conversation on screen. On terminal status →
// unread dot + refetch, and any message queued behind that turn is sent
// (the attached onDone flush can't run for a detached finish). The card's
// own SSE handles the attached case; owned entries are skipped. Mounted
// once in ChatHost.

import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { CHAT_SESSIONS_KEY, chatFetch, chatSessionKey } from '@/hooks/use-chat-sessions';
import {
  clearActiveTurn,
  persistActiveTurn,
  readPersistedActiveTurns,
} from '@/hooks/use-chat-turn';
import type { ChatAttachment } from '@/lib/schemas/chat';
import { conversationKey, useChatStore } from '@/stores/chat-store';
import { usePageContextStore } from '@/stores/page-context-store';

export const WATCH_INTERVAL_MS = 2500;

/** Upload queued draft files to their conversation (mirror of the card's
 * uploadFiles — the watcher's detached flush can't reach the card's closure).
 * Throws on a non-OK response so the caller re-queues instead of dropping. */
async function uploadQueuedFiles(conversationId: string, files: File[]): Promise<ChatAttachment[]> {
  if (files.length === 0) return [];
  const fd = new FormData();
  fd.set('conversationId', conversationId);
  for (const f of files) fd.append('files', f);
  const res = await fetch('/api/chat/uploads', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Upload failed');
  return ((await res.json()) as { attachments: ChatAttachment[] }).attachments;
}

/** Send the message + attachments queued behind a turn that finished DETACHED
 * — the attached onDone auto-send never ran for it. Uploads the queued files
 * first (like a normal send), then posts the turn with their metadata. The new
 * turn joins the persisted list, so the watcher covers it (unread dot on
 * finish) and a return to the thread reattaches to it. On failure the text AND
 * files go back into their queue slots so nothing the user staged is lost. */
async function flushQueuedMessage(queryClient: QueryClient, conversationId: string): Promise<void> {
  const store = useChatStore.getState();
  const key = conversationKey(conversationId);
  const queued = store.takeQueuedMessage(key);
  const files = store.takeQueuedAttachments(key);
  if (queued == null && files.length === 0) return;
  // On-screen awareness (mirror of the card's send): the semantic page summary
  // and any staged selection chips, read at flush time from their stores.
  const pageContext =
    usePageContextStore.getState().context ?? `viewing ${window.location.pathname}`;
  const selections = store.selections;
  try {
    const attachments = await uploadQueuedFiles(conversationId, files);
    const override = store.modelOverride[conversationId];
    const res = await chatFetch<{ turnId: string } | { setupRequired: true }>(
      `/api/chat/sessions/${encodeURIComponent(conversationId)}/turns`,
      {
        method: 'POST',
        body: JSON.stringify({
          message: queued ?? '',
          ...(attachments.length ? { attachments } : {}),
          ...(selections.length ? { selections } : {}),
          ...(override ? { provider: override.provider, model: override.model } : {}),
          pageContext,
        }),
      },
    );
    if ('setupRequired' in res) throw new Error('setup required');
    persistActiveTurn({ turnId: res.turnId, conversationId });
    useChatStore.getState().clearSelections();
    queryClient.invalidateQueries({ queryKey: chatSessionKey(conversationId) });
  } catch {
    const s = useChatStore.getState();
    s.setQueuedMessage(key, queued);
    s.setQueuedAttachments(key, files);
  }
}

/** One poll step — exported for tests (no timers involved). */
export async function backgroundTurnTick(queryClient: QueryClient): Promise<void> {
  for (const persisted of readPersistedActiveTurns()) {
    const { open, activeConversationId } = useChatStore.getState();
    if (open && activeConversationId === persisted.conversationId) continue; // card owns the stream
    let status: string | null = null;
    try {
      const res = await fetch(`/api/chat/turns/${encodeURIComponent(persisted.turnId)}`);
      status = res.ok ? ((await res.json()) as { status: string }).status : null;
    } catch {
      continue; // transient network error — try again next tick
    }
    if (status === 'running') continue;
    // Re-check AFTER the await: the attached stream may have finished and
    // cleared the record mid-probe, or the user may have re-entered the
    // thread — in either case the card owns the result, not the watcher,
    // and marking unread here would dot a reply the user just watched.
    if (!readPersistedActiveTurns().some(t => t.turnId === persisted.turnId)) continue;
    const after = useChatStore.getState();
    if (after.open && after.activeConversationId === persisted.conversationId) continue;
    clearActiveTurn(persisted.turnId);
    // 404/unknown (status null, e.g. server restart) → no dot: we cannot know
    // whether a reply actually landed. Refetch either way.
    if (status === 'done' || status === 'error') after.markUnread(persisted.conversationId);
    queryClient.invalidateQueries({ queryKey: chatSessionKey(persisted.conversationId) });
    queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
    // Auto-send the queued follow-up ONLY while the chat is open (the user is
    // still in it, just on another thread). When the chat is CLOSED the queue
    // is HELD — sending a turn nobody is watching spends tokens unattended;
    // the composer restores the held text as an editable draft on reopen.
    if (status === 'done' && after.open) {
      await flushQueuedMessage(queryClient, persisted.conversationId);
    }
  }
}

export function useBackgroundTurnWatcher(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const id = setInterval(() => void backgroundTurnTick(queryClient), WATCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [queryClient]);
}
