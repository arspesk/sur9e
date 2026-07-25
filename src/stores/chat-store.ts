import { create, type StateCreator } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface ModelOverride {
  provider: string;
  model: string;
}

/** localStorage key for the persisted per-conversation model overrides.
 * ONLY the `modelOverride` slice is written here — see `partialize` below. */
export const CHAT_STORE_PERSIST_KEY = 'sur9e.chat.model-override';

/** Store key used before the first conversation exists — the slot the user
 * fills pre-conversation; adoptDraftOverride moves every draft slot onto
 * the real id after POST /api/chat/sessions creates one. */
export const DRAFT_OVERRIDE_KEY = 'draft';

/** Key for the per-conversation Records below. */
export const conversationKey = (id: string | null): string => id ?? DRAFT_OVERRIDE_KEY;

/** On-screen-awareness selection (Part 2): capped to this many chars so one
 * giant selection can't blow the turn payload (the route enforces the same
 * ceiling). Only ever one chip is staged at a time — see `selections`. */
export const MAX_SELECTION_CHARS = 2000;

interface ChatState {
  /** Card open (true) vs collapsed bubble (false). */
  open: boolean;
  activeConversationId: string | null;
  /** Turn currently streaming into the transcript (null when idle). */
  streamingTurnId: string | null;
  /** Message typed while a reply streams — keyed per conversation, auto-sent
   * after that conversation's 'done'. */
  queuedMessages: Record<string, string>;
  /** Files attached while a reply streams — parallel to queuedMessages, keyed
   * per conversation. Held as in-memory File[] (never persisted) and uploaded
   * + sent together with the queued text when the queue flushes on 'done'. */
  queuedAttachments: Record<string, File[]>;
  /** On-screen text selection captured while the chat is open (Part 2) —
   * rendered as a removable composer chip and sent as context the assistant
   * reacts to. A single global draft slot (not per conversation): at most ONE
   * chip at a time (a new selection replaces the current one), each capped to
   * MAX_SELECTION_CHARS, cleared on a successful send OR when the user
   * deselects on the page. Kept as an array so the send path and chip renderer
   * stay uniform, but its length is always 0 or 1. */
  selections: string[];
  /** Last message the user sent, keyed per conversation — Retry re-sends it. */
  lastUserMessages: Record<string, string>;
  /** A prompt handed to the chat by another surface (e.g. Home's "Draft
   * follow-up") to be SENT on arrival, not merely typed. Deliberately NOT the
   * queuedMessages slot: the composer restores that one into the input, and
   * the two consumers would race. Read-and-cleared exactly once by the
   * conversation hook. */
  autoSendMessage: string | null;
  /** Which door the user came through to reach /chat, so the page can enter
   * from where they were looking: the hero composer sits mid-page and its
   * counterpart glides down to dock, while the bubble is a bottom-right card
   * that grows outward. Null for a cold load or a rail click, which get no
   * directional motion.
   *
   * Cleared on a short timer by the page rather than read-and-cleared, because
   * starting a new thread rewrites /chat → /chat/[id], and those are different
   * route segments: the page remounts mid-journey and a consume-on-first-mount
   * would leave the second mount with nothing to animate. */
  chatEntryOrigin: 'home' | 'bubble' | null;
  /** Backend refused with the onboarding-preflight shape → show setup card. */
  setupRequired: boolean;
  /** Per-conversation provider/model override (DRAFT_OVERRIDE_KEY pre-create). */
  modelOverride: Record<string, ModelOverride>;
  /** True while the offers drawer has auto-minimized an open chat card. */
  minimizedByDrawer: boolean;
  /** Conversations whose reply finished while they were not on screen. */
  unreadConversationIds: string[];
  markUnread: (id: string) => void;
  clearUnread: (id: string) => void;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  setMinimizedByDrawer: (v: boolean) => void;
  setActiveConversation: (id: string | null) => void;
  setStreamingTurnId: (id: string | null) => void;
  setQueuedMessage: (key: string, text: string | null) => void;
  /** Read-and-clear — one consumer (the post-done auto-send) may win. */
  takeQueuedMessage: (key: string) => string | null;
  /** Set (or clear, with null/empty) the queued attachments for a key. */
  setQueuedAttachments: (key: string, files: File[] | null) => void;
  /** Read-and-clear the queued attachments — returns [] when the slot is empty. */
  takeQueuedAttachments: (key: string) => File[];
  setLastUserMessage: (key: string, text: string) => void;
  /** Stage a captured selection (trimmed + capped to MAX_SELECTION_CHARS) as
   * the ONE current chip — a new selection REPLACES whatever was there, never
   * stacks. A no-op when the text is empty or identical to the current chip. */
  addSelection: (text: string) => void;
  /** Remove the chip at `index` (a removed chip is gone for good). */
  removeSelection: (index: number) => void;
  /** Drop every selection — called after a successful send. */
  clearSelections: () => void;
  setChatEntryOrigin: (origin: 'home' | 'bubble' | null) => void;
  setAutoSendMessage: (text: string | null) => void;
  /** Read-and-clear — only the first caller after a handoff wins. */
  takeAutoSendMessage: () => string | null;
  setSetupRequired: (v: boolean) => void;
  setModelOverride: (key: string, pair: ModelOverride | null) => void;
  /** Move every draft-keyed slot (model override, queued, last-user) onto the
   * conversation id the first send just created. */
  adoptDraftOverride: (conversationId: string) => void;
}

/** Copy `rec` with the draft slot re-keyed onto `id` (no-op without a draft). */
function adoptDraftSlot<T>(rec: Record<string, T>, id: string): Record<string, T> {
  if (!(DRAFT_OVERRIDE_KEY in rec)) return rec;
  const next = { ...rec, [id]: rec[DRAFT_OVERRIDE_KEY] };
  delete next[DRAFT_OVERRIDE_KEY];
  return next;
}

function withoutId(ids: string[], id: string | null): string[] {
  return id ? ids.filter(u => u !== id) : ids;
}

const createChatState: StateCreator<ChatState> = (set, get) => ({
  open: false,
  activeConversationId: null,
  streamingTurnId: null,
  queuedMessages: {},
  queuedAttachments: {},
  selections: [],
  lastUserMessages: {},
  autoSendMessage: null,
  chatEntryOrigin: null,
  setupRequired: false,
  modelOverride: {},
  minimizedByDrawer: false,
  unreadConversationIds: [],
  markUnread: id =>
    set(s =>
      s.unreadConversationIds.includes(id)
        ? s
        : { unreadConversationIds: [...s.unreadConversationIds, id] },
    ),
  clearUnread: id => set(s => ({ unreadConversationIds: withoutId(s.unreadConversationIds, id) })),
  openChat: () =>
    set(s => ({
      open: true,
      minimizedByDrawer: false,
      unreadConversationIds: withoutId(s.unreadConversationIds, s.activeConversationId),
    })),
  closeChat: () => set({ open: false, minimizedByDrawer: false }),
  toggleChat: () =>
    set(s => ({
      open: !s.open,
      minimizedByDrawer: false,
      unreadConversationIds: s.open
        ? s.unreadConversationIds
        : withoutId(s.unreadConversationIds, s.activeConversationId),
    })),
  setMinimizedByDrawer: v => set({ minimizedByDrawer: v }),
  setActiveConversation: id =>
    set(s => ({
      activeConversationId: id,
      unreadConversationIds: withoutId(s.unreadConversationIds, id),
    })),
  setStreamingTurnId: id => set({ streamingTurnId: id }),
  setQueuedMessage: (key, text) =>
    set(s => {
      const next = { ...s.queuedMessages };
      if (text == null) delete next[key];
      else next[key] = text;
      return { queuedMessages: next };
    }),
  takeQueuedMessage: key => {
    const q = get().queuedMessages[key] ?? null;
    if (q != null) {
      set(s => {
        const next = { ...s.queuedMessages };
        delete next[key];
        return { queuedMessages: next };
      });
    }
    return q;
  },
  setQueuedAttachments: (key, files) =>
    set(s => {
      const next = { ...s.queuedAttachments };
      if (files == null || files.length === 0) delete next[key];
      else next[key] = files;
      return { queuedAttachments: next };
    }),
  takeQueuedAttachments: key => {
    const files = get().queuedAttachments[key] ?? [];
    if (files.length > 0) {
      set(s => {
        const next = { ...s.queuedAttachments };
        delete next[key];
        return { queuedAttachments: next };
      });
    }
    return files;
  },
  setLastUserMessage: (key, text) =>
    set(s => ({ lastUserMessages: { ...s.lastUserMessages, [key]: text } })),
  addSelection: text =>
    set(s => {
      const trimmed = text.trim().slice(0, MAX_SELECTION_CHARS);
      // Single chip: a new selection REPLACES the current one. No-op when it's
      // empty or already the staged chip (avoids a needless re-render).
      if (!trimmed || (s.selections.length === 1 && s.selections[0] === trimmed)) return s;
      return { selections: [trimmed] };
    }),
  removeSelection: index => set(s => ({ selections: s.selections.filter((_, i) => i !== index) })),
  clearSelections: () => set(s => (s.selections.length ? { selections: [] } : s)),
  setChatEntryOrigin: origin => set({ chatEntryOrigin: origin }),
  setAutoSendMessage: text => set({ autoSendMessage: text }),
  takeAutoSendMessage: () => {
    const text = get().autoSendMessage;
    if (text != null) set({ autoSendMessage: null });
    return text;
  },
  setSetupRequired: v => set({ setupRequired: v }),
  setModelOverride: (key, pair) =>
    set(s => {
      const next = { ...s.modelOverride };
      if (pair == null) delete next[key];
      else next[key] = pair;
      return { modelOverride: next };
    }),
  adoptDraftOverride: conversationId =>
    set(s => ({
      modelOverride: adoptDraftSlot(s.modelOverride, conversationId),
      queuedMessages: adoptDraftSlot(s.queuedMessages, conversationId),
      queuedAttachments: adoptDraftSlot(s.queuedAttachments, conversationId),
      lastUserMessages: adoptDraftSlot(s.lastUserMessages, conversationId),
    })),
});

/** Only `modelOverride` (a Record keyed by conversation id — DRAFT_OVERRIDE_KEY
 * pre-create) survives a reload. Every other slice is session-only: `open`,
 * `activeConversationId`, `streamingTurnId`, `queuedMessages`,
 * `queuedAttachments` (File[] — not serializable), `selections`,
 * `lastUserMessages`, `setupRequired`, `minimizedByDrawer`,
 * `unreadConversationIds`. `skipHydration` keeps SSR and the first client render
 * on the empty default (ModelChip reads `modelOverride` at render time, and the
 * chat root is SSR'd — reading localStorage during that first render would
 * desync SSR from the client and throw a hydration error); ChatHost calls
 * `useChatStore.persist.rehydrate()` in a mount effect to load the overrides. */
export const useChatStore = create<ChatState>()(
  persist(createChatState, {
    name: CHAT_STORE_PERSIST_KEY,
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: state => ({ modelOverride: state.modelOverride }),
    skipHydration: true,
  }),
);
