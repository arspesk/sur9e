// Drawer auto-minimize plumbing on the chat store itself: the store exposes
// a `minimizedByDrawer` flag + setter, and every existing open/close/toggle
// action clears it — a manual chat action always cancels a pending
// drawer-triggered restore (spec §6 collision rules).

import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '@/stores/chat-store';

beforeEach(() => {
  useChatStore.setState({ open: false, minimizedByDrawer: false });
});

describe('chat store — drawer minimize plumbing', () => {
  it('setMinimizedByDrawer flips the flag independently of open', () => {
    useChatStore.getState().setMinimizedByDrawer(true);
    expect(useChatStore.getState().minimizedByDrawer).toBe(true);
    expect(useChatStore.getState().open).toBe(false);
    useChatStore.getState().setMinimizedByDrawer(false);
    expect(useChatStore.getState().minimizedByDrawer).toBe(false);
  });

  it('openChat clears a pending drawer-restore flag', () => {
    useChatStore.setState({ open: false, minimizedByDrawer: true });
    useChatStore.getState().openChat();
    expect(useChatStore.getState().open).toBe(true);
    expect(useChatStore.getState().minimizedByDrawer).toBe(false);
  });

  it('closeChat clears a pending drawer-restore flag', () => {
    useChatStore.setState({ open: true, minimizedByDrawer: true });
    useChatStore.getState().closeChat();
    expect(useChatStore.getState().open).toBe(false);
    expect(useChatStore.getState().minimizedByDrawer).toBe(false);
  });

  it('toggleChat clears a pending drawer-restore flag', () => {
    useChatStore.setState({ open: false, minimizedByDrawer: true });
    useChatStore.getState().toggleChat();
    expect(useChatStore.getState().open).toBe(true);
    expect(useChatStore.getState().minimizedByDrawer).toBe(false);
  });
});
