// lib/schemas/chat.ts
//
// Zod schemas for the AI chat foundation (design spec §3.3/§3.4).
// Shared client+server like jobs.ts: conversations/messages persist in
// data/chat.db (node:sqlite, see src/lib/server/chat/), turn events stream
// over SSE. The exported names and shapes here are the contract the chat
// UI plan and the MCP actions plan build against — do not rename.

import { z } from 'zod';

export const ChatRole = z.enum(['user', 'assistant']);
export type ChatRole = z.infer<typeof ChatRole>;

export const Conversation = z.object({
  id: z.string(),
  title: z.string(),
  // NULL/'auto' = machine-set (AI titler may overwrite); 'manual' = user
  // rename (sticky). default(null) keeps pre-migration rows and old
  // fixtures parseable.
  titleSource: z.enum(['auto', 'manual']).nullable().default(null),
  mode: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof Conversation>;

// Mirrors the server's resolveChatUploadPath shape — '<conv uuid>/<file
// uuid>.<ext>'. Constrained at the schema too so a crafted path (traversal,
// absolute path) never survives the turns route's zod parse; the prompt
// builder re-verifies on top of this before handing paths to the CLI.
const UUID_SEG = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CHAT_ATTACHMENT_PATH_RE = new RegExp(`^${UUID_SEG}/${UUID_SEG}\\.[a-z0-9]+$`);
export const ChatAttachment = z.object({
  /** Relative to data/chat/uploads — '<conversationId>/<uuid>.<ext>'. */
  path: z.string().regex(CHAT_ATTACHMENT_PATH_RE),
  name: z.string().max(255),
  mime: z.string().max(100),
  size: z.number().int().nonnegative(),
});
export type ChatAttachment = z.infer<typeof ChatAttachment>;

export const ChatMessage = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: ChatRole,
  content: z.string(),
  // Turn events captured while the assistant message streamed (tool cards,
  // thinking blocks, …). Kept loose (unknown[]) — the transcript renderer
  // re-parses through ChatTurnEvent per element and skips what it can't read.
  events: z.array(z.unknown()).nullable(),
  // Regeneration group: replies sharing a group are versions of one another.
  // default(null) keeps pre-migration rows and old fixtures parseable.
  versionGroup: z.string().nullable().default(null),
  // Files uploaded with a user message ([{path,name,mime,size}]).
  // default(null) keeps pre-migration rows and old fixtures parseable.
  attachments: z.array(ChatAttachment).nullable().default(null),
  // Offer nums @-mentioned in a user message ([3, 48]).
  // default(null) keeps pre-migration rows and old fixtures parseable.
  referencedOffers: z.array(z.number().int().positive()).nullable().default(null),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const AgentSessionHandle = z.object({
  conversationId: z.string(),
  provider: z.string(),
  providerSessionId: z.string(),
  model: z.string(),
  cwd: z.string(),
  // Id of the last assistant message this provider session has "seen".
  // The resume-identity guard compares it against the conversation's
  // actual latest assistant message before reusing the session.
  lastMessageId: z.string().nullable(),
});
export type AgentSessionHandle = z.infer<typeof AgentSessionHandle>;

// Every event carries a monotonically increasing per-turn seq so the SSE
// route can replay `?after=<seq>` on reconnect (spec §3.4).
const seq = z.number().int().nonnegative();

export const ChatActionLink = z.object({
  label: z.string().min(1),
  href: z.string().regex(/^\/[A-Za-z0-9\-_/]*$/),
});
export type ChatActionLink = z.infer<typeof ChatActionLink>;

export const ChatTurnEvent = z.discriminatedUnion('type', [
  z.object({ seq, type: z.literal('text-delta'), text: z.string() }),
  z.object({ seq, type: z.literal('thinking'), text: z.string() }),
  z.object({
    seq,
    type: z.literal('tool'),
    name: z.string(),
    detail: z.string().optional(),
    status: z.enum(['start', 'done', 'error']),
    // Provider call id (claude tool_use_id, codex item.id, opencode callID).
    // Optional so tool events persisted before this field still parse. When
    // present, foldEvents pairs a 'done'/'error' event to the exact 'start'
    // it closes by id — so a tool chip resolves its spinner to ✓/✕ even if the
    // close event carries no name (claude's tool_result lines don't).
    id: z.string().optional(),
  }),
  z.object({ seq, type: z.literal('stage'), label: z.string() }),
  z.object({ seq, type: z.literal('ui'), action: z.literal('navigate'), path: z.string() }),
  z.object({
    seq,
    type: z.literal('confirm'),
    token: z.string(),
    summary: z.string(),
    meta: z.string(),
    // Which gated action this card confirms — lets the resolved card render an
    // action-specific done message (start-job → "running in the jobs strip",
    // set-status → "Status updated", update-offer → "Offer updated"). Optional
    // so confirm events persisted before this field existed still parse; the
    // card falls back to a generic "Confirmed" label when it's absent.
    kind: z
      .enum([
        'start-job',
        'start-workflow',
        'cancel-job',
        'cancel-workflow',
        'create-offer-from-text',
        'set-status',
        'update-offer',
      ])
      .optional(),
  }),
  z.object({
    seq,
    type: z.literal('confirm-resolved'),
    token: z.string(),
    outcome: z.enum(['approved', 'cancelled', 'expired']),
    // Approval records the user's decision; execution qualifies whether the
    // gated action actually changed state. Optional for persisted events from
    // before execution outcomes were recorded.
    execution: z.enum(['succeeded', 'failed', 'unchanged']).optional(),
    message: z.string().optional(),
    links: z.array(ChatActionLink).optional(),
  }),
  z.object({
    seq,
    type: z.literal('usage'),
    costUsd: z.number().nullable(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
    model: z.string().nullable(),
  }),
  // `message` is a humanized, user-facing sentence (never raw stderr —
  // src/lib/server/providers/humanize-error.ts). `category` is the optional
  // classify-error bucket ('auth'|'quota'|…) the turn runner attaches so the
  // UI can branch (e.g. deep-link Settings on 'auth') without re-parsing text.
  z.object({ seq, type: z.literal('error'), message: z.string(), category: z.string().optional() }),
  z.object({ seq, type: z.literal('done'), messageId: z.string() }),
]);
export type ChatTurnEvent = z.infer<typeof ChatTurnEvent>;
