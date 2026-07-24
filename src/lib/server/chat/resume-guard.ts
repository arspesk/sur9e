// src/lib/server/chat/resume-guard.ts
//
// Resume-identity guard (design spec §3.1, Open Design agent-session-resume
// pattern). A stored provider session handle may be reused for --resume only
// when nothing that shaped the session has changed: same provider+model,
// same cwd, and the handle's cursor still points at the conversation's
// latest assistant message (i.e. no turn happened outside this session).
// Pure function — all inputs explicit, fully unit-tested.

import 'server-only';
import type { AgentSessionHandle } from '../../schemas/chat';

export type ResumeRejection =
  | 'no_handle'
  | 'model_changed'
  | 'cwd_changed'
  | 'missing_cursor'
  | 'conversation_advanced';

export type ResumeVerdict = { ok: true } | { ok: false; reason: ResumeRejection };

export function validateResume(
  handle: AgentSessionHandle | null,
  ctx: {
    provider: string;
    model: string;
    cwd: string;
    lastAssistantMessageId: string | null;
  },
): ResumeVerdict {
  if (!handle) return { ok: false, reason: 'no_handle' };
  // Provider mismatch collapses into model_changed: the store lookup is
  // provider-keyed so it "can't happen", but a defensive caller passing a
  // mismatched handle must still land on a fresh session.
  if (handle.provider !== ctx.provider || handle.model !== ctx.model) {
    return { ok: false, reason: 'model_changed' };
  }
  if (handle.cwd !== ctx.cwd) return { ok: false, reason: 'cwd_changed' };
  if (handle.lastMessageId === null) return { ok: false, reason: 'missing_cursor' };
  if (handle.lastMessageId !== ctx.lastAssistantMessageId) {
    return { ok: false, reason: 'conversation_advanced' };
  }
  return { ok: true };
}
