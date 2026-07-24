'use client';

import { useEffect, useRef } from 'react';
import { useTextSelectionCapture } from '@/hooks/use-text-selection-capture';
import { useChatStore } from '@/stores/chat-store';
import { useDrawerStore } from '@/stores/drawer-store';
import { ChatBubble } from './chat-bubble';
import { ChatCard } from './chat-card';
import { timePercent } from './chat-jobs-lib';
import { ChatJobsRuntime } from './chat-jobs-runtime';
import { useChatJobsStore } from './chat-jobs-store';
import { useBackgroundTurnWatcher } from './use-background-turn-watcher';
import { useJobElapsed } from './use-chat-job-poll';

/** Mounted once in src/app/layout.tsx. Renders the collapsed bubble OR the
 * open card. Plan 4 wires the live job count and the collision/auto-minimize
 * rules. */
export function ChatHost() {
  useBackgroundTurnWatcher();
  // Global text-selection → composer-chip capture (Part 2). Lives here so the
  // listener spans the whole session; it only captures while the card is open.
  useTextSelectionCapture();
  const open = useChatStore(s => s.open);
  const toggleChat = useChatStore(s => s.toggleChat);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Load the persisted per-conversation model overrides. The chat store uses
  // `skipHydration` (see chat-store.ts) so SSR and the first client render both
  // sit on the empty default — reading localStorage during that first render
  // (ModelChip reads modelOverride while the SSR'd chat root paints) would
  // desync SSR from the client and throw a hydration error. Rehydrating here,
  // post-mount and client-only, swaps in the saved overrides one render later.
  // A rehydrate failure (localStorage blocked in private mode, over quota, or
  // corrupt JSON) is non-fatal — the chat just keeps the default model.
  useEffect(() => {
    void Promise.resolve(useChatStore.persist.rehydrate()).catch(() => {});
  }, []);

  // Focus returns to the bubble on close. The focus trap's automatic restore
  // can't do it — the bubble unmounts while the card is open, so the captured
  // element is stale. This effect focuses the freshly-mounted bubble instead.
  useEffect(() => {
    if (wasOpen.current && !open) bubbleRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // A sibling toast-lift rule keys its CSS off body[data-chat-open] so the
  // toast column clears the open card instead of stacking under it.
  useEffect(() => {
    if (open) document.body.setAttribute('data-chat-open', 'true');
    else document.body.removeAttribute('data-chat-open');
    return () => document.body.removeAttribute('data-chat-open');
  }, [open]);

  // Offers drawer collision: the drawer opening over an open chat card
  // auto-minimizes it to the bubble; the drawer closing restores it, but
  // only when the drawer was what minimized it. A manual open/close/toggle
  // (bubble click, Escape, close button) clears minimizedByDrawer, so a
  // chat the user dismissed themselves while the drawer was up never
  // reopens itself. Tracks the previous drawer state so the effect only
  // acts on a true open<->closed transition, not every render.
  const drawerOpen = useDrawerStore(s => s.open);
  const prevDrawerOpen = useRef(drawerOpen);
  useEffect(() => {
    if (drawerOpen === prevDrawerOpen.current) return;
    prevDrawerOpen.current = drawerOpen;
    const chat = useChatStore.getState();
    if (drawerOpen) {
      if (chat.open) {
        chat.closeChat();
        chat.setMinimizedByDrawer(true);
      }
    } else if (chat.minimizedByDrawer) {
      chat.openChat();
    }
  }, [drawerOpen]);

  // Live jobs feed → bubble badge + ring. Non-terminal jobs count toward the
  // badge; the ACTIVE (last-in-order) job drives the ring's progress.
  const jobsMap = useChatJobsStore(s => s.jobs);
  const jobsOrder = useChatJobsStore(s => s.order);
  const activeJobCount = jobsOrder.filter(id => {
    const st = jobsMap[id]?.snapshot?.status;
    return st !== 'done' && st !== 'error';
  }).length;

  // Persistent bubble badges: a job that reaches a TERMINAL state (error or
  // done) while the chat is CLOSED stays flagged on the bubble until the
  // user opens the chat or dismisses the job. One seen-set covers both.
  const seenTerminalIds = useChatJobsStore(s => s.seenTerminalIds);
  const markTerminalSeen = useChatJobsStore(s => s.markTerminalSeen);
  const errorJobIds = jobsOrder.filter(id => jobsMap[id]?.snapshot?.status === 'error');
  const doneJobIds = jobsOrder.filter(id => jobsMap[id]?.snapshot?.status === 'done');
  const unseenErrorCount = errorJobIds.filter(id => !seenTerminalIds.includes(id)).length;
  const unseenDoneCount = doneJobIds.filter(id => !seenTerminalIds.includes(id)).length;
  const terminalIdsKey = [...errorJobIds, ...doneJobIds].join(',');

  // Acknowledge on open AND on any terminal transition while already open —
  // only jobs finishing while the chat is CLOSED ever reach the bubble.
  useEffect(() => {
    if (!open) return;
    markTerminalSeen();
  }, [open, terminalIdsKey, markTerminalSeen]);

  const frontId = jobsOrder.at(-1);
  const frontEntry = frontId ? jobsMap[frontId] : undefined;
  const frontElapsed = useJobElapsed(frontId);
  const frontIsActive =
    frontEntry != null &&
    frontEntry.snapshot?.status !== 'done' &&
    frontEntry.snapshot?.status !== 'error';
  // timePercent returns 0–96 (percent); ChatBubble's ring wants a 0..1 arc.
  const jobProgress = frontIsActive ? timePercent(frontElapsed, frontEntry.kind) / 100 : undefined;

  return (
    <>
      <ChatJobsRuntime />
      {!open && (
        <ChatBubble
          ref={bubbleRef}
          open={open}
          jobCount={activeJobCount}
          jobProgress={jobProgress}
          errorCount={unseenErrorCount}
          doneCount={unseenDoneCount}
          onClick={toggleChat}
        />
      )}
      {open && <ChatCard />}
    </>
  );
}
