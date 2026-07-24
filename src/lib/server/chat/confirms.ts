// src/lib/server/chat/confirms.ts
//
// In-memory confirm-token store for chat-initiated actions. Every spend
// (start_job) and every write (set_status) requires an explicit user
// approval, always — createConfirm parks the payload behind a token and
// emits a {type:'confirm'} turn event; resolveConfirm executes (or
// discards) the payload when the web UI posts the user's decision.
//
// In-memory by design: a confirm is only meaningful while its turn's SSE
// stream is alive, and a server restart kills both together. 15-minute
// TTL so an abandoned card can never execute a stale payload.

import 'server-only';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { jobEstimateLabel } from '../../job-types';
import type { ApplicationRow } from '../../schemas/applications';
import type { JobType } from '../../schemas/jobs';
import { updateStatus } from '../applications';
import {
  type JobConflictPayload,
  type JobRecord,
  type JobSetupRequiredPayload,
  startJob,
} from '../jobs';
import { resolveModeRuntime } from '../providers/registry';
import { applyReportBodyEdit, parseFrontmatter, saveReport } from '../reports';
import { appendConfirmResolution } from './store';
import { emitTurnEvent } from './turn-runner';

const TTL_MS = 15 * 60 * 1000;

export type ConfirmKind = 'start-job' | 'set-status' | 'edit-report';

export interface StartJobPayload {
  kind: JobType;
  params?: Record<string, unknown>;
}

export interface SetStatusPayload {
  num: number;
  status: string;
}

export interface EditReportPayload {
  num: number;
  /** Resolved on-disk report path — the route resolves it before parking so
   * the resolver never re-derives it (and can't drift if the file is renamed). */
  filePath: string;
  oldText: string;
  newText: string;
}

type ConfirmPayload = StartJobPayload | SetStatusPayload | EditReportPayload;

interface ConfirmRecord {
  token: string;
  turnId: string;
  kind: ConfirmKind;
  payload: ConfirmPayload;
  summary: string;
  meta: string;
  createdAt: number;
}

// The store lives on globalThis, not at module level: Turbopack may
// re-evaluate this module within one dev process (HMR), and a module-level
// Map would silently drop every pending confirm token on an unrelated edit —
// leaving an open confirm card to fail with 'expired' on approve. Same
// pattern as db.ts / turn-runner.ts.
const confirms: Map<string, ConfirmRecord> = ((
  globalThis as unknown as { __sur9eChatConfirms?: Map<string, ConfirmRecord> }
).__sur9eChatConfirms ??= new Map());

function sweepExpired(): void {
  const now = Date.now();
  for (const [token, rec] of confirms) {
    if (now - rec.createdAt > TTL_MS) confirms.delete(token);
  }
}

export interface CreateConfirmInput {
  turnId: string;
  kind: ConfirmKind;
  payload: ConfirmPayload;
  summary: string;
  meta: string;
}

/**
 * Park an action payload behind a fresh token and show the user a
 * confirm card (emitted as a turn event). Nothing executes until
 * resolveConfirm(token, true).
 *
 * `_root` is unused today (the store is process-global) but kept so the
 * call shape matches resolveConfirm and stays stable if the store ever
 * becomes root-scoped.
 */
export function createConfirm(_root: string, input: CreateConfirmInput): { token: string } {
  sweepExpired();
  const token = randomUUID();
  confirms.set(token, { token, createdAt: Date.now(), ...input });
  emitTurnEvent(input.turnId, {
    type: 'confirm',
    token,
    summary: input.summary,
    meta: input.meta,
    // Carry the action kind so the resolved card (live and after reload) can
    // render an action-specific done message — this rides into the assistant
    // message's persisted events, where appendConfirmResolution later appends
    // the matching confirm-resolved.
    kind: input.kind,
  });
  return { token };
}

export type ConfirmOutcome = 'approved' | 'cancelled' | 'expired';

export type ConfirmExecutionResult =
  | { ok: true; job: JobRecord | JobConflictPayload | JobSetupRequiredPayload }
  | { ok: true; updated: ApplicationRow | undefined }
  | { ok: true; report: { num: number } }
  | { ok: false; error: string };

export interface ResolveConfirmResult {
  outcome: ConfirmOutcome;
  /** Present only on approval: what the execution produced. */
  result?: ConfirmExecutionResult;
}

/**
 * Resolve a pending confirm. Approval executes the parked payload through
 * the same library functions the web buttons use (startJob / updateStatus
 * — single source of effects). Unknown, already-resolved, and past-TTL
 * tokens all resolve to 'expired' and execute nothing.
 */
export function resolveConfirm(
  root: string,
  token: string,
  approve: boolean,
): ResolveConfirmResult {
  const rec = confirms.get(token);
  if (!rec) {
    // Unknown/swept token: nothing to execute, but if the owning message is
    // still on disk (turn long over), stamp the terminal state so a reopened
    // card doesn't offer buttons for an action that can never run again.
    persistResolution(root, token, 'expired');
    return { outcome: 'expired' };
  }
  confirms.delete(token);
  if (Date.now() - rec.createdAt > TTL_MS) {
    persistResolution(root, token, 'expired');
    return { outcome: 'expired' };
  }

  const outcome: ConfirmOutcome = approve ? 'approved' : 'cancelled';
  let result: ConfirmExecutionResult | undefined;
  if (approve) {
    try {
      if (rec.kind === 'start-job') {
        const p = rec.payload as StartJobPayload;
        result = { ok: true, job: startJob(root, { kind: p.kind, params: p.params }) };
      } else if (rec.kind === 'edit-report') {
        const p = rec.payload as EditReportPayload;
        // RE-READ at resolve time: the card may have sat open while the user
        // (or another editor save) changed the file. applyReportBodyEdit
        // re-validates the unique match against the CURRENT bytes, so a
        // vanished old_text throws here → { ok:false, error } instead of a
        // silent clobber. Frontmatter is preserved (re-parsed from the edited
        // markdown, which applyReportBodyEdit never touches).
        const current = readFileSync(p.filePath, 'utf-8');
        const edited = applyReportBodyEdit(current, p.oldText, p.newText);
        if ('error' in edited) throw new Error(edited.error);
        const { frontmatter, body } = parseFrontmatter(edited.markdown);
        saveReport({ filePath: p.filePath, frontmatter, body });
        result = { ok: true, report: { num: p.num } };
      } else {
        const p = rec.payload as SetStatusPayload;
        result = { ok: true, updated: updateStatus(root, p.num, p.status) };
      }
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Best-effort: the turn may have finished streaming by the time the
  // user clicks — the resolution itself still stands.
  try {
    emitTurnEvent(rec.turnId, { type: 'confirm-resolved', token, outcome });
  } catch {
    // no live turn to notify
  }
  // The live event above only reaches an open SSE stream; a click after the
  // turn's 'done' (the common case) never touches the persisted message.
  // Stamp the resolution onto that message too so a reload shows the resolved
  // card instead of re-armed buttons for an action that already ran.
  persistResolution(root, token, outcome);
  return { outcome, result };
}

/** Best-effort persistence of a confirm's terminal state onto its owning
 * assistant message. Never throws into the resolution path — a failed write
 * only means a reload would show the pre-fix (pending) card, not a crash. */
function persistResolution(root: string, token: string, outcome: ConfirmOutcome): void {
  try {
    appendConfirmResolution(root, token, outcome);
  } catch {
    // never let a persistence hiccup break resolution
  }
}

// ── Summary / meta builders (shared by the action routes) ────────────────────

const KIND_LABELS: Record<JobType, string> = {
  evaluate: 'evaluation',
  'tailor-cv': 'CV tailoring',
  'cover-letter': 'cover letter',
  research: 'company research',
  'interview-prep': 'interview prep',
  'reach-out': 'outreach draft',
  negotiate: 'negotiation strategy',
  scan: 'portal scan',
  'batch-evaluate': 'batch evaluation',
  screen: 'screening',
  'screen-evaluate': 'screen + evaluate',
};

/**
 * Confirm-card copy for a start-job action. Meta format:
 * '<provider> · <model> · <est duration>' — src/lib/job-types.ts carries
 * duration estimates only (no cost figures), so cost is omitted.
 */
export function describeStartJob(
  root: string,
  kind: JobType,
  params?: Record<string, unknown>,
): { summary: string; meta: string } {
  const label = KIND_LABELS[kind] ?? kind;
  const num = params && Number.isInteger(params.num) ? (params.num as number) : null;
  const summary = num == null ? `Start ${label}` : `Start ${label} for offer #${num}`;
  let pair = '';
  try {
    // Job kinds and mode ids share names (jobs-mode-naming invariant), so
    // the kind doubles as the modeId for runtime resolution.
    const rt = resolveModeRuntime(root, kind);
    pair = `${rt.provider} · ${rt.model} · `;
  } catch {
    // No runtime resolvable — show duration only.
  }
  return { summary, meta: `${pair}${jobEstimateLabel(kind)}` };
}

/** Confirm-card copy for a tracker status write (no AI spend involved). */
export function describeSetStatus(num: number, status: string): { summary: string; meta: string } {
  return {
    summary: `Set offer #${num} status to "${status}"`,
    meta: 'tracker write · no AI spend',
  };
}

/** Collapse whitespace and clip a preview snippet to ≤40 chars, appending an
 * ellipsis only when the source was actually truncated. */
function editPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 40 ? `${collapsed.slice(0, 40)}…` : collapsed;
}

/**
 * Confirm-card copy for a surgical report body edit (a local file write — no
 * AI spend). Summary is the user's optional description, else `Edit report
 * #<num>`; meta previews the find/replace so the card shows what changes.
 */
export function describeEditReport(
  num: number,
  oldText: string,
  newText: string,
  summary?: string,
): { summary: string; meta: string } {
  return {
    summary: summary?.trim() || `Edit report #${num}`,
    meta: `report write · "${editPreview(oldText)}" → "${editPreview(newText)}" · no AI spend`,
  };
}
