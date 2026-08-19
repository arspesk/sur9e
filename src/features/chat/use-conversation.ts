'use client';

// Conversation orchestration extracted from ChatCard so more than one surface
// can host a chat: the corner bubble (chat-card.tsx), the full-screen /chat
// page (chat-page.tsx), and the Home hero composer (features/home/home-hero).
//
// Everything here moved VERBATIM from chat-card.tsx — the per-thread isolation
// and reattach effects below are load-bearing and their ref guards are subtle
// (see the comments). The only addition is opts.onAfterSend, which Home uses
// to navigate to /chat once a turn has started.
//
// Layout concerns (the card's DOM ref, focus trap, drag-over state, Escape
// handling) deliberately stay with each host component.

import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHAT_SESSIONS_KEY,
  ChatApiError,
  chatFetch,
  chatSessionKey,
  useChatSession,
} from '@/hooks/use-chat-sessions';
import {
  clearActiveTurn,
  persistActiveTurn,
  readPersistedTurnFor,
  useChatTurn,
} from '@/hooks/use-chat-turn';
import type { ChatAttachment, ChatMessage, Conversation } from '@/lib/schemas/chat';
import { conversationKey, useChatStore } from '@/stores/chat-store';
import { usePageContextStore } from '@/stores/page-context-store';
import type { LiveTurn } from './chat-transcript';

// Resting ("no suppression") value for suppressResetForRef. A real conversation
// id is a string and the "New chat" / draft id is `null`; a Symbol can equal
// NEITHER. The previous resting value was `null`, which collided with the
// new-chat id — `null === null` wrongly matched the suppress guard, skipped
// turn.reset(), and left the previous thread's stream attached and rendering.
const NO_SUPPRESS = Symbol('no-suppress');

export interface ConversationApi {
  messages: ChatMessage[];
  conversationStatus: 'new' | 'loading' | 'ready' | 'error';
  conversationError: string | null;
  live: LiveTurn | null;
  streaming: boolean;
  /** Raw turn status — hosts announce transitions to screen readers. */
  turnStatus: 'idle' | 'streaming' | 'done' | 'error';
  pendingUserMessage: string | null;
  pendingUserMessageId: string | null;
  sendError: string | null;
  setupRequired: boolean;
  draftFiles: File[];
  setDraftFiles: React.Dispatch<React.SetStateAction<File[]>>;
  showEmpty: boolean;
  send: (text: string, referencedOffers?: number[], files?: File[]) => Promise<void>;
  stop: () => Promise<void>;
  retry: () => void;
  retryConversation: () => void;
  regenerate: () => Promise<void>;
}

export function useConversation(opts?: {
  onAfterSend?: () => void;
  /** Send a prompt staged by another surface (see chat-store.autoSendMessage).
   * Only the full-screen chat page opts in. */
  consumeAutoSend?: boolean;
}): ConversationApi {
  const activeConversationId = useChatStore(s => s.activeConversationId);
  const setActiveConversation = useChatStore(s => s.setActiveConversation);
  const streamingTurnId = useChatStore(s => s.streamingTurnId);
  const setStreamingTurnId = useChatStore(s => s.setStreamingTurnId);
  const setupRequired = useChatStore(s => s.setupRequired);
  const setSetupRequired = useChatStore(s => s.setSetupRequired);
  const adoptDraftOverride = useChatStore(s => s.adoptDraftOverride);

  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [pendingUserMessageId, setPendingUserMessageId] = useState<string | null>(null);
  const [doneMessageId, setDoneMessageId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  // Draft attachments live HERE (not the composer) — the host is the drop
  // target, and send() consumes them. Attaching stays live during streaming:
  // Enter moves the draft files into the queuedAttachments slot, and the
  // post-'done' flush sends them with the queued text (see onDone / submit).
  const [draftFiles, setDraftFiles] = useState<File[]>([]);
  const router = useRouter();
  const queryClient = useQueryClient();

  const sessionQuery = useChatSession(activeConversationId);
  const session = sessionQuery.data;
  const messages: ChatMessage[] = session?.messages ?? [];
  const conversationStatus =
    activeConversationId == null
      ? 'new'
      : session != null
        ? 'ready'
        : sessionQuery.isError
          ? 'error'
          : 'loading';
  const conversationError =
    conversationStatus === 'error'
      ? sessionQuery.error instanceof Error
        ? sessionQuery.error.message
        : 'Conversation failed to load.'
      : null;

  // send() and the turn hook reference each other (done → auto-send queued),
  // so the hook reads send through a ref that each render refreshes.
  // The queued auto-send calls sendRef.current(queuedText, [], queuedFiles) —
  // text + attachments carry through the queue slots, but mention metadata does
  // not (accepted limitation; the mention text itself still tells the model
  // what to read).
  const sendRef = useRef<
    (text: string, referencedOffers?: number[], files?: File[]) => Promise<void>
  >(async () => {});

  // opts is a fresh object literal on most renders — read the callback through
  // a ref so send()'s useCallback identity doesn't churn every render.
  const onAfterSendRef = useRef(opts?.onAfterSend);
  onAfterSendRef.current = opts?.onAfterSend;

  // The AI title lands asynchronously AFTER 'done' (server fire-and-forget).
  // Two delayed sessions-list refetches catch it; cleared on unmount.
  const titleTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      for (const t of titleTimersRef.current) clearTimeout(t);
    },
    [],
  );

  const turn = useChatTurn({
    onEvent: event => {
      // event.path is a server-emitted runtime string (the AI chat backend
      // deciding where to send the user), not a literal Next can verify
      // against the App Router route tree at compile time — same escape
      // hatch as the typed Route<T> cast in mobile-nav.tsx.
      if (event.type === 'ui' && event.action === 'navigate') router.push(event.path as Route);
    },
    onDone: messageId => {
      setStreamingTurnId(null);
      setDoneMessageId(messageId);
      const id = useChatStore.getState().activeConversationId;
      if (id) queryClient.invalidateQueries({ queryKey: chatSessionKey(id) });
      queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
      const store = useChatStore.getState();
      const key = conversationKey(id);
      const queuedText = store.takeQueuedMessage(key);
      const queuedFiles = store.takeQueuedAttachments(key);
      if (queuedText != null || queuedFiles.length > 0) {
        void sendRef.current(queuedText ?? '', [], queuedFiles);
      }
      for (const delay of [6000, 15000]) {
        titleTimersRef.current.push(
          setTimeout(() => queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY }), delay),
        );
      }
    },
  });

  async function uploadFiles(conversationId: string, files: File[]): Promise<ChatAttachment[]> {
    if (files.length === 0) return [];
    const fd = new FormData();
    fd.set('conversationId', conversationId);
    for (const f of files) fd.append('files', f);
    const res = await fetch('/api/chat/uploads', { method: 'POST', body: fd });
    if (!res.ok) {
      let msg = 'Upload failed';
      try {
        msg = String(((await res.json()) as { error?: string }).error ?? msg);
      } catch {
        // non-JSON body — keep the generic message
      }
      throw new Error(msg);
    }
    return ((await res.json()) as { attachments: ChatAttachment[] }).attachments;
  }

  const send = useCallback(
    async (text: string, referencedOffers: number[] = [], filesOverride?: File[]) => {
      // filesOverride carries the queued-attachments slot on the post-'done'
      // flush; a normal send consumes the live draft chips instead.
      const files = filesOverride ?? draftFiles;
      setSetupRequired(false);
      setSendError(null);
      setDoneMessageId(null);
      const store = useChatStore.getState();
      store.setLastUserMessage(conversationKey(store.activeConversationId), text);
      setPendingUserMessageId(null);
      setPendingUserMessage(
        text ||
          (files.length ? `[${files.length} attached file${files.length === 1 ? '' : 's'}]` : text),
      );
      let createdConversationId: string | null = null;
      try {
        let conversationId = useChatStore.getState().activeConversationId;
        if (!conversationId) {
          // Committed route answers POST with `{ session }` (see route file).
          const created = await chatFetch<{ session: Conversation }>('/api/chat/sessions', {
            method: 'POST',
            body: JSON.stringify({}),
          });
          conversationId = created.session.id;
          createdConversationId = conversationId;
        }
        // Attachments force conversation creation FIRST (above) by design —
        // no draft-upload dance; the upload needs a real conversation id.
        const attachments = await uploadFiles(conversationId, files); // throws → catch shows sendError, files kept
        const overrideStore = useChatStore.getState().modelOverride;
        const override =
          overrideStore[conversationId] ??
          (createdConversationId ? overrideStore[conversationKey(null)] : undefined);
        // On-screen awareness: the semantic page summary the active surface
        // published (Part 1), and the text selections staged as chips (Part 2).
        // Both are read at send time from their stores; context falls back to
        // the bare pathname for an unmapped route.
        const pageContext =
          usePageContextStore.getState().context ?? `viewing ${window.location.pathname}`;
        const selections = useChatStore.getState().selections;
        // 200 + `{ setupRequired: true }` is a NORMAL body, not a thrown error.
        const res = await chatFetch<
          { turnId: string; userMessageId: string | null } | { setupRequired: true }
        >(`/api/chat/sessions/${encodeURIComponent(conversationId)}/turns`, {
          method: 'POST',
          body: JSON.stringify({
            message: text,
            ...(attachments.length ? { attachments } : {}),
            ...(referencedOffers.length ? { referencedOffers } : {}),
            ...(selections.length ? { selections } : {}),
            ...(override ? { provider: override.provider, model: override.model } : {}),
            pageContext,
          }),
        });
        if ('setupRequired' in res) {
          setPendingUserMessage(null);
          setPendingUserMessageId(null);
          setSetupRequired(true);
          if (createdConversationId) {
            suppressResetForRef.current = createdConversationId;
            setActiveConversation(createdConversationId);
            adoptDraftOverride(createdConversationId);
            queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
          }
          return;
        }
        setPendingUserMessageId(res.userMessageId);
        setStreamingTurnId(res.turnId);
        persistActiveTurn({ turnId: res.turnId, conversationId });
        turn.start(res.turnId);
        if (createdConversationId) {
          const destinationConversationId = createdConversationId;
          // Seed the destination query before the route changes. The new page
          // then mounts with the persisted user row instead of swapping the
          // optimistic transcript for a loading/empty frame; later invalidation
          // still refreshes it normally while retaining this cached snapshot.
          await queryClient.prefetchQuery({
            queryKey: chatSessionKey(destinationConversationId),
            queryFn: () =>
              chatFetch<{ session: Conversation; messages: ChatMessage[] }>(
                `/api/chat/sessions/${encodeURIComponent(destinationConversationId)}`,
              ),
          });
          // Keep the draft surface mounted until the server has persisted the
          // user message and the live turn exists. Activating sooner rewrites
          // /chat → /chat/:id, remounts this hook, and exposes the still-empty
          // conversation while the turn POST is in flight.
          suppressResetForRef.current = createdConversationId;
          setActiveConversation(createdConversationId);
          adoptDraftOverride(createdConversationId);
          queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
        }
        // The server inserts the user's message row synchronously inside
        // startTurn, so it provably exists now. Without this invalidate the
        // session query can still hold the empty snapshot it fetched when the
        // conversation was created a few lines above (staleTime is 5min and
        // refetchOnMount is off once data exists) — which is why a message
        // sent from Home stayed invisible on /chat until the reply finished.
        queryClient.invalidateQueries({ queryKey: chatSessionKey(conversationId) });
        // The send went through — the staged selection chips belong to this
        // turn now, so clear the draft slot (a queued-flush re-entry re-reads
        // an already-empty slot, so this is safe on that path too).
        useChatStore.getState().clearSelections();
        // Only a normal send consumed the draft chips — a flush used the
        // queued slot, so leave any newly-drafted files for the next message.
        if (filesOverride === undefined) setDraftFiles([]);
        // Host hook: Home navigates to /chat once the turn is live. Runs after
        // the turn exists so the destination reattaches to a real stream.
        onAfterSendRef.current?.();
      } catch (err) {
        setPendingUserMessage(null);
        setPendingUserMessageId(null);
        if (err instanceof ChatApiError && err.setupRequired) {
          setSetupRequired(true);
          return;
        }
        setSendError(err instanceof Error ? err.message : 'Message failed to send.');
      }
    },
    [
      adoptDraftOverride,
      draftFiles,
      queryClient,
      setActiveConversation,
      setSetupRequired,
      setStreamingTurnId,
      turn,
    ],
  );
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // ── Auto-send handoff ──
  // Another surface (Home's "Draft follow-up") can stage a prompt and navigate
  // here for it to be sent on arrival. Opt-in per host — the bubble must not
  // consume a handoff meant for the full-screen page, or the prompt would fire
  // into whichever surface mounted first.
  const autoSendClaimedRef = useRef(false);
  useEffect(() => {
    if (!opts?.consumeAutoSend || autoSendClaimedRef.current) return;
    const text = useChatStore.getState().takeAutoSendMessage();
    if (!text) return;
    autoSendClaimedRef.current = true;
    void sendRef.current(text);
  }, [opts?.consumeAutoSend]);

  // ── Per-thread isolation ──
  // Live-turn view state (SSE events, optimistic echo, done/error markers)
  // belongs to ONE conversation. Switching threads detaches the stream
  // client-side (the server turn keeps running) and clears the per-thread
  // view state so thread B never renders thread A's turn.
  // suppressResetForRef whitelists the two id changes that are NOT a switch:
  // the draft→created transition inside send(), and the reload-reattach jump.
  // It rests at NO_SUPPRESS (a Symbol) rather than `null` so opening a new chat
  // (id → null) can never accidentally match the guard: `null` is a real chat
  // state, and the resting sentinel must differ from every id AND from null.
  const prevConvRef = useRef(activeConversationId);
  const suppressResetForRef = useRef<string | typeof NO_SUPPRESS>(NO_SUPPRESS);
  // True once the card has ever settled on a real conversation this mount.
  // Distinguishes a genuine reload/mount (active has ALWAYS been null → the
  // persisted in-flight turn should be reattached, case (a) in the reattach
  // effect) from a deliberate "New chat" (active went null AFTER a real thread
  // → the user's leave-intent wins; do NOT yank the UI back into the previous
  // still-running turn — the background watcher still completes + persists it).
  const hasActivatedConversationRef = useRef(activeConversationId != null);
  useEffect(() => {
    if (prevConvRef.current === activeConversationId) return;
    prevConvRef.current = activeConversationId;
    if (activeConversationId != null) hasActivatedConversationRef.current = true;
    if (suppressResetForRef.current === activeConversationId) {
      suppressResetForRef.current = NO_SUPPRESS;
      return;
    }
    turn.reset(); // detach only — an in-flight server turn keeps running
    setPendingUserMessage(null);
    setPendingUserMessageId(null);
    setDoneMessageId(null);
    setSendError(null);
    setStreamingTurnId(null);
    // Draft attachments are per-thread too — without this, a file dropped in
    // thread A would upload into whichever thread the next send happens in.
    setDraftFiles([]);
  }, [activeConversationId, turn, setStreamingTurnId]);

  // ── Reattach ──
  // Runs on mount AND whenever the active conversation changes. Covers:
  // (a) reload mid-turn with no conversation selected yet → jump to the
  //     persisted conversation (the effect then re-runs and lands in (b));
  // (b) the active conversation owns the persisted turn → probe its status;
  //     still running → reattach with full replay (after=0, lossless);
  //     finished/unknown (404 after a server restart) → drop the record and
  //     refetch, the persisted messages are the source of truth.
  // `turn` is a fresh object every render, so this effect re-fires on EVERY
  // render — reattachKeyRef caps each (conversation, turnId) pair at one
  // probe + one attach while healthy (leaving the thread re-arms it), and
  // the streaming bail-out skips the pair the card is already attached to.
  // No effect-cleanup staleness flag: it would trip on every re-render and
  // strand an in-flight probe — the async continuation instead re-checks
  // the probe token and the store before acting.
  const reattachKeyRef = useRef<string | null>(null);
  const probeSeqRef = useRef(0);
  useEffect(() => {
    // Per-conversation lookup into the persisted LIST: only the active
    // thread's own turn is probed; other threads' background turns stay
    // untouched (the watcher covers them).
    const persisted = readPersistedTurnFor(activeConversationId);
    if (!persisted) {
      reattachKeyRef.current = null; // no in-flight turn here — a return may re-probe
      return;
    }
    if (activeConversationId == null) {
      // Deliberate "New chat": active went null AFTER a real thread. Honor the
      // user's leave-intent — do NOT snap back to the previous running turn
      // (the background watcher still finishes it). Only a fresh reload/mount,
      // where active has never been anything but null, may jump to reattach.
      if (hasActivatedConversationRef.current) return;
      suppressResetForRef.current = persisted.conversationId;
      setActiveConversation(persisted.conversationId);
      return;
    }
    // Already attached to this turn (normal send, or a finished reattach).
    if (streamingTurnId === persisted.turnId && turn.status === 'streaming') return;
    const key = `${persisted.conversationId}:${persisted.turnId}`;
    if (reattachKeyRef.current === key) return; // probe in flight / attached
    reattachKeyRef.current = key;
    const probeId = ++probeSeqRef.current;
    void (async () => {
      let status: string | null = null;
      try {
        const res = await fetch(`/api/chat/turns/${encodeURIComponent(persisted.turnId)}`);
        status = res.ok ? ((await res.json()) as { status: string }).status : null;
      } catch {
        status = null;
      }
      // Superseded by a newer probe, or the user moved on mid-probe.
      if (probeId !== probeSeqRef.current) return;
      if (useChatStore.getState().activeConversationId !== persisted.conversationId) return;
      if (status === 'running') {
        setStreamingTurnId(persisted.turnId);
        turn.start(persisted.turnId, 0);
      } else {
        clearActiveTurn(persisted.turnId);
        setStreamingTurnId(null);
        queryClient.invalidateQueries({ queryKey: chatSessionKey(activeConversationId) });
        queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY });
        // The turn finished while detached — DON'T auto-send anything queued
        // behind it. The queue slot is left intact; the composer restores it
        // as an editable draft so sending stays an explicit, attended act
        // (never unattended token spend). See the composer's restore effect.
      }
    })();
  }, [
    activeConversationId,
    streamingTurnId,
    queryClient,
    setActiveConversation,
    setStreamingTurnId,
    turn,
  ]);

  const streaming = turn.status === 'streaming' && streamingTurnId != null;

  async function handleStop() {
    const store = useChatStore.getState();
    const turnId = store.streamingTurnId;
    const conversationId = store.activeConversationId;
    if (!turnId) {
      turn.detach();
      setStreamingTurnId(null);
      return;
    }
    // Stay ATTACHED while cancelling (issue #106): the server emits the
    // terminal 'cancelled' event through the stream and persists the partial
    // assistant message synchronously before this POST returns — detaching
    // first (the old behavior) cut off the terminal event and left the
    // transcript looking wiped.
    try {
      await fetch(`/api/chat/turns/${encodeURIComponent(turnId)}/cancel`, { method: 'POST' });
    } catch {
      // Cancel unreachable (server down, or a race with a turn that already
      // finished) — degrade to detach-only so the composer never sticks.
      turn.detach();
      setStreamingTurnId(null);
      clearActiveTurn(turnId);
      return;
    }
    setStreamingTurnId(null);
    clearActiveTurn(turnId); // idempotent with the hook's own error-path clear
    if (conversationId) {
      // The partial is provably persisted by now — pull it into the message
      // list, then retire the live copy so it renders exactly once.
      await queryClient.invalidateQueries({ queryKey: chatSessionKey(conversationId) });
    }
    setPendingUserMessage(null);
    setPendingUserMessageId(null);
    turn.reset();
  }

  function handleRetry() {
    const s = useChatStore.getState();
    const last = s.lastUserMessages[conversationKey(s.activeConversationId)];
    if (last) void send(last);
  }

  async function handleRegenerate() {
    const conversationId = useChatStore.getState().activeConversationId;
    if (!conversationId) return;
    setSendError(null);
    setDoneMessageId(null);
    try {
      const override = useChatStore.getState().modelOverride[conversationId];
      const res = await chatFetch<{ turnId: string } | { setupRequired: true }>(
        `/api/chat/sessions/${encodeURIComponent(conversationId)}/turns`,
        {
          method: 'POST',
          body: JSON.stringify({
            regenerate: true,
            ...(override ? { provider: override.provider, model: override.model } : {}),
          }),
        },
      );
      if ('setupRequired' in res) {
        setSetupRequired(true);
        return;
      }
      setStreamingTurnId(res.turnId);
      persistActiveTurn({ turnId: res.turnId, conversationId });
      turn.start(res.turnId);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Regenerate failed.');
    }
  }

  // The live turn stays rendered while streaming, on error (error row +
  // Retry), and after done until the persisted assistant message lands in
  // the refetched list — no empty flash between 'done' and the refetch.
  const persistedLanded = doneMessageId != null && messages.some(m => m.id === doneMessageId);
  useEffect(() => {
    if (persistedLanded) {
      setPendingUserMessage(null);
      setPendingUserMessageId(null);
    }
  }, [persistedLanded]);
  const live: LiveTurn | null =
    turn.status !== 'idle' && !persistedLanded
      ? {
          events: turn.events,
          status:
            turn.status === 'streaming' && streamingTurnId == null
              ? 'done'
              : (turn.status as LiveTurn['status']),
        }
      : null;

  const showEmpty =
    (conversationStatus === 'new' || conversationStatus === 'ready') &&
    !setupRequired &&
    messages.length === 0 &&
    live == null &&
    pendingUserMessage == null;

  return {
    messages,
    conversationStatus,
    conversationError,
    live,
    streaming,
    turnStatus: turn.status,
    pendingUserMessage,
    pendingUserMessageId,
    sendError,
    setupRequired,
    draftFiles,
    setDraftFiles,
    showEmpty,
    send,
    stop: handleStop,
    retry: handleRetry,
    retryConversation: () => {
      void sessionQuery.refetch();
    },
    regenerate: handleRegenerate,
  };
}
