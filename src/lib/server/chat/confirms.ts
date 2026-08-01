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
import { ApplicationStatus } from '../../schemas/applications';
import type { TextOfferStartKind } from '../../schemas/chat-actions';
import type { JobType } from '../../schemas/jobs';
import type { WorkflowRecord } from '../../schemas/workflows';
import { type JobConflictPayload, type JobRecord, type JobSetupRequiredPayload } from '../jobs';
import { type CancelJobResult, cancelJob } from '../jobs/lifecycle';
import { resolveModeRuntime } from '../providers/registry';
import { applyReportBodyEdit, parseFrontmatter, saveReport } from '../reports';
import { updateStatusWithFollowup } from '../status-transition-followup';
import { createOrReuseTextOffer, type TextOfferResult } from '../text-offers';
import { cancelWorkflow, createWorkflow, type WorkflowPlan, workflowChildJobs } from '../workflows';
import { startChatJob } from './job-start';
import { appendConfirmAfter, appendConfirmResolution } from './store';
import { emitTurnEvent, getTurn } from './turn-runner';

const TTL_MS = 15 * 60 * 1000;

export type ConfirmKind =
  | 'start-job'
  | 'start-workflow'
  | 'cancel-job'
  | 'cancel-workflow'
  | 'create-offer-from-text'
  | 'set-status'
  | 'edit-report';

export interface StartJobPayload {
  kind: JobType;
  params?: Record<string, unknown>;
}

export interface StartWorkflowPayload {
  targets: Array<{ num: number } | { url: string }>;
  modes: string[];
  guidance?: string;
}

export interface CancelWorkflowPayload {
  workflowId: string;
}

export interface SetStatusPayload {
  num: number;
  status: string;
}

export interface CancelJobPayload {
  jobId: string;
}

export interface CreateOfferFromTextPayload {
  text: string;
  url?: string;
  company?: string;
  role?: string;
  startKind?: TextOfferStartKind;
  modes?: string[];
  reservedNum?: number;
}

export interface EditReportPayload {
  num: number;
  /** Resolved on-disk report path — the route resolves it before parking so
   * the resolver never re-derives it (and can't drift if the file is renamed). */
  filePath: string;
  oldText: string;
  newText: string;
}

type ConfirmPayload =
  | StartJobPayload
  | StartWorkflowPayload
  | CancelJobPayload
  | CancelWorkflowPayload
  | CreateOfferFromTextPayload
  | SetStatusPayload
  | EditReportPayload;

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
export type ConfirmExecution = 'succeeded' | 'failed' | 'unchanged';

export interface ConfirmResultLink {
  label: string;
  href: string;
}

export interface ConfirmResultPresentation {
  message?: string;
  links?: ConfirmResultLink[];
}

type ConfirmExecutionPayload =
  | { job: JobRecord | JobConflictPayload | JobSetupRequiredPayload }
  | { workflow: WorkflowRecord; jobs: JobRecord[] }
  | { workflow: WorkflowRecord; cancelledWorkflow: boolean }
  | { updated: ApplicationRow | undefined }
  | { report: { num: number } }
  | { cancellation: CancelJobResult }
  | {
      textOffer: TextOfferResult;
      job?: JobRecord | JobConflictPayload | JobSetupRequiredPayload;
      workflow?: WorkflowRecord;
      jobs?: JobRecord[];
    };

export type ConfirmExecutionResult =
  | ({ ok: true } & ConfirmExecutionPayload & ConfirmResultPresentation)
  | { ok: false; error: string };

export interface ResolveConfirmResult {
  outcome: ConfirmOutcome;
  execution?: ConfirmExecution;
  /** Present only on approval: what the execution produced. */
  result?: ConfirmExecutionResult;
  /** A successfully placed, separately gated preparation job prompt. */
  followupConfirm?: { token: string };
}

function executionFor(
  kind: ConfirmKind,
  result: ConfirmExecutionResult | undefined,
): ConfirmExecution | undefined {
  if (!result) return undefined;
  if (!result.ok) return 'failed';
  if (kind === 'cancel-job' && 'cancellation' in result) {
    return result.cancellation.job.status === 'cancelled' ? 'succeeded' : 'unchanged';
  }
  if (kind === 'start-job' && 'job' in result) {
    const status = result.job && 'status' in result.job ? result.job.status : undefined;
    return status === 'queued' || status === 'running' ? 'succeeded' : 'unchanged';
  }
  if (kind === 'start-workflow' && 'workflow' in result && result.workflow) {
    return result.workflow.status === 'error' ? 'failed' : 'succeeded';
  }
  if (kind === 'cancel-workflow' && 'cancelledWorkflow' in result) {
    return result.cancelledWorkflow ? 'succeeded' : 'unchanged';
  }
  if (kind === 'set-status' && 'updated' in result) {
    return result.updated ? 'succeeded' : 'unchanged';
  }
  return 'succeeded';
}

function jobsForWorkflow(root: string, workflow: WorkflowRecord): JobRecord[] {
  return workflowChildJobs(root, workflow);
}

function placeFollowupConfirm(
  root: string,
  rec: ConfirmRecord,
  parentToken: string,
  followup: NonNullable<ReturnType<typeof updateStatusWithFollowup>['followup']>,
  persistedResolutionPlaced: boolean,
): { followupConfirm?: { token: string }; warning?: string } {
  const childToken = randomUUID();
  const { summary, meta } = describeStartJob(root, followup.jobKind, { num: followup.num });
  let childPlaced = false;
  if (persistedResolutionPlaced) {
    try {
      childPlaced = appendConfirmAfter(root, parentToken, {
        token: childToken,
        summary,
        meta,
      });
    } catch {
      // Fall through to the live turn placement below.
    }
  }
  if (!childPlaced && getTurn(rec.turnId)?.status === 'running') {
    try {
      childPlaced =
        emitTurnEvent(rec.turnId, {
          type: 'confirm',
          token: childToken,
          summary,
          meta,
          kind: 'start-job',
        }) !== null;
    } catch {
      // no live turn to place the follow-up on
    }
  }
  if (!childPlaced) {
    return { warning: 'Status updated, but the preparation prompt could not be shown.' };
  }
  confirms.set(childToken, {
    token: childToken,
    turnId: rec.turnId,
    kind: 'start-job',
    payload: { kind: followup.jobKind, params: { num: followup.num } },
    summary,
    meta,
    createdAt: Date.now(),
  });
  return { followupConfirm: { token: childToken } };
}

/**
 * Resolve a pending confirm. Approval executes the parked payload through
 * the same library functions the web buttons use (startJob / updateStatus
 * — single source of effects). Unknown, already-resolved, and past-TTL
 * tokens all resolve to 'expired' and execute nothing.
 */
export async function resolveConfirm(
  root: string,
  token: string,
  approve: boolean,
): Promise<ResolveConfirmResult> {
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
  let statusFollowup: ReturnType<typeof updateStatusWithFollowup>['followup'] = null;
  if (approve) {
    try {
      if (rec.kind === 'start-job') {
        const p = rec.payload as StartJobPayload;
        const job = startChatJob(root, p.kind, p.params);
        result = { ok: true, job, ...describeStartedJob(p.kind, p.params, job) };
      } else if (rec.kind === 'start-workflow') {
        const p = rec.payload as StartWorkflowPayload;
        const workflow = createWorkflow(root, p);
        const jobs = jobsForWorkflow(root, workflow);
        result = {
          ok: true,
          workflow,
          jobs,
          ...describeStartedWorkflow(workflow),
        };
      } else if (rec.kind === 'cancel-job') {
        const p = rec.payload as CancelJobPayload;
        result = { ok: true, cancellation: cancelJob(root, p.jobId) };
      } else if (rec.kind === 'cancel-workflow') {
        const p = rec.payload as CancelWorkflowPayload;
        const cancellation = cancelWorkflow(root, p.workflowId);
        const { workflow } = cancellation;
        result = {
          ok: true,
          workflow,
          cancelledWorkflow: cancellation.cancelled,
          message: cancellation.cancelled
            ? `Workflow ${workflow.id} cancelled.`
            : `Workflow ${workflow.id} was already ${workflow.status}.`,
        };
      } else if (rec.kind === 'create-offer-from-text') {
        const p = rec.payload as CreateOfferFromTextPayload;
        if (p.startKind && p.modes) {
          throw new Error('startKind and modes cannot be combined');
        }
        const textOffer = await createOrReuseTextOffer(root, p);
        const job = p.startKind
          ? startChatJob(root, p.startKind, { num: textOffer.offer.num })
          : undefined;
        const workflow = p.modes
          ? createWorkflow(root, { targets: [{ num: textOffer.offer.num }], modes: p.modes })
          : undefined;
        const jobs = workflow ? jobsForWorkflow(root, workflow) : undefined;
        result = {
          ok: true,
          textOffer,
          ...(job ? { job } : {}),
          ...(workflow ? { workflow, jobs } : {}),
          ...describeTextOfferResult(textOffer, p.startKind, job, workflow),
        };
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
        const status = ApplicationStatus.parse(p.status);
        const transition = updateStatusWithFollowup(root, p.num, status);
        statusFollowup = transition.followup;
        result = { ok: true, updated: transition.updated };
      }
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const execution = approve ? executionFor(rec.kind, result) : undefined;
  const presentation =
    result?.ok === true
      ? {
          ...(result.message ? { message: result.message } : {}),
          ...(result.links ? { links: result.links } : {}),
        }
      : {};

  // Best-effort: the turn may have finished streaming by the time the
  // user clicks — the resolution itself still stands.
  try {
    emitTurnEvent(rec.turnId, {
      type: 'confirm-resolved',
      token,
      outcome,
      ...(execution ? { execution } : {}),
      ...presentation,
    });
  } catch {
    // no live turn to notify
  }
  // The live event above only reaches an open SSE stream; a click after the
  // turn's 'done' (the common case) never touches the persisted message.
  // Stamp the resolution onto that message too so a reload shows the resolved
  // card instead of re-armed buttons for an action that already ran.
  const persistedResolutionPlaced = persistResolution(
    root,
    token,
    outcome,
    execution,
    presentation,
  );

  let followupConfirm: { token: string } | undefined;
  if (approve && rec.kind === 'set-status' && result?.ok && statusFollowup) {
    const placement = placeFollowupConfirm(
      root,
      rec,
      token,
      statusFollowup,
      persistedResolutionPlaced,
    );
    followupConfirm = placement.followupConfirm;
    if (placement.warning) {
      result = {
        ...result,
        message: placement.warning,
      };
      // The parent resolution was persisted before child placement so the
      // child could be appended after it. Merge the late warning back onto
      // that durable event; otherwise reload would lose this failure detail.
      persistResolution(root, token, outcome, execution, { message: placement.warning });
    }
  }
  return {
    outcome,
    ...(execution ? { execution } : {}),
    result,
    ...(followupConfirm ? { followupConfirm } : {}),
  };
}

/** Best-effort persistence of a confirm's terminal state onto its owning
 * assistant message. Never throws into the resolution path — a failed write
 * only means a reload would show the pre-fix (pending) card, not a crash. */
function persistResolution(
  root: string,
  token: string,
  outcome: ConfirmOutcome,
  execution?: ConfirmExecution,
  presentation?: ConfirmResultPresentation,
): boolean {
  try {
    return appendConfirmResolution(root, token, outcome, execution, presentation);
  } catch {
    // never let a persistence hiccup break resolution
    return false;
  }
}

// ── Summary / meta builders (shared by the action routes) ────────────────────

const KIND_LABELS: Record<JobType, string> = {
  evaluate: 'evaluation',
  'tailor-cv': 'CV tailoring',
  latex: 'LaTeX CV generation',
  'cover-letter': 'cover letter',
  research: 'company research',
  'interview-prep': 'interview prep',
  'reach-out': 'outreach draft',
  negotiate: 'negotiation strategy',
  scan: 'portal scan',
  'batch-evaluate': 'batch evaluation',
  screen: 'screening',
  'screen-evaluate': 'screening → evaluation',
};

function offerLink(num: number): ConfirmResultLink[] {
  return [{ label: `Offer #${num}`, href: `/report/${num}` }];
}

function workflowLinks(workflow: WorkflowRecord): ConfirmResultLink[] {
  return workflow.targets.flatMap(target =>
    'num' in target && typeof target.num === 'number' && Number.isInteger(target.num)
      ? offerLink(target.num)
      : [],
  );
}

export function describeStartedWorkflow(workflow: WorkflowRecord): ConfirmResultPresentation {
  const targetCount = workflow.targets.length;
  const modeCount = workflow.requestedModes.length;
  return {
    message: `Workflow started: ${modeCount} mode${modeCount === 1 ? '' : 's'} across ${targetCount || 1} target${targetCount === 1 ? '' : 's'}.`,
    links: workflowLinks(workflow),
  };
}

export function describeStartedJob(
  kind: JobType,
  params: Record<string, unknown> | undefined,
  job?: JobRecord | JobConflictPayload | JobSetupRequiredPayload,
): ConfirmResultPresentation {
  const num = Number.isInteger(params?.num) ? (params?.num as number) : null;
  const links = num == null ? undefined : offerLink(num);
  if (job && 'conflict' in job) return { message: job.message, ...(links ? { links } : {}) };
  if (kind === 'screen-evaluate') {
    return {
      message:
        num == null
          ? 'Screening started; evaluation will start after screening succeeds.'
          : `Screening started for offer #${num}; evaluation will start after screening succeeds.`,
      ...(links ? { links } : {}),
    };
  }
  const label = KIND_LABELS[kind] ?? kind;
  return {
    message:
      num == null
        ? `${label[0]?.toUpperCase()}${label.slice(1)} started.`
        : `${label[0]?.toUpperCase()}${label.slice(1)} started for offer #${num}.`,
    ...(links ? { links } : {}),
  };
}

export function describeTextOfferResult(
  textOffer: TextOfferResult,
  startKind?: TextOfferStartKind,
  job?: JobRecord | JobConflictPayload | JobSetupRequiredPayload,
  workflow?: WorkflowRecord,
): ConfirmResultPresentation {
  const num = textOffer.offer.num;
  const created = textOffer.reused ? 'reused' : 'created';
  let followup = '';
  if (workflow) {
    followup = ` Workflow started with ${workflow.requestedModes.join(' → ')}.`;
  } else if (startKind && job && 'conflict' in job) {
    followup = ` ${job.message}`;
  } else if (startKind === 'screen-evaluate') {
    followup = ' Screening started; evaluation will start after screening succeeds.';
  } else if (startKind === 'screen') {
    followup = ' Screening started.';
  } else if (startKind) {
    followup = ` ${(KIND_LABELS[startKind] ?? startKind).replace(/^./, c => c.toUpperCase())} started.`;
  }
  return {
    message: `Offer #${num} ${created}.${followup}`,
    links: offerLink(num),
  };
}

export function describeStartWorkflow(
  input: StartWorkflowPayload,
  plan?: WorkflowPlan,
): {
  summary: string;
  meta: string;
} {
  const targetCount = input.targets.length || 1;
  const modeCount = input.modes.length;
  const labels = input.modes.map(mode => KIND_LABELS[mode as JobType] ?? mode);
  let phaseLabel = labels.join(' → ');
  if (plan) {
    const depths = new Map<string, number>();
    const phases = new Map<number, string[]>();
    for (const step of plan.steps) {
      const depth =
        step.dependsOn.length === 0
          ? 0
          : Math.max(...step.dependsOn.map(id => depths.get(id) ?? 0)) + 1;
      depths.set(step.id, depth);
      const label = KIND_LABELS[step.mode as JobType] ?? step.mode;
      const phase = phases.get(depth) ?? [];
      if (!phase.includes(label)) phase.push(label);
      phases.set(depth, phase);
    }
    phaseLabel = [...phases.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, phase]) => phase.join(' + '))
      .join(' → ');
  }
  return {
    summary: `Run ${modeCount} mode${modeCount === 1 ? '' : 's'} for ${targetCount} target${targetCount === 1 ? '' : 's'}`,
    meta: `${phaseLabel}${targetCount > 1 ? ` · ${targetCount} targets in parallel` : ''} · dependency-aware · max 4 parallel`,
  };
}

export function describeCancelWorkflow(workflow: WorkflowRecord): {
  summary: string;
  meta: string;
} {
  const active = workflow.steps.filter(step => step.status === 'running').length;
  const queued = workflow.steps.filter(
    step => step.status === 'queued' || step.status === 'blocked',
  ).length;
  return {
    summary: `Cancel workflow ${workflow.id}`,
    meta: `${active} active · ${queued} queued · partial output kept`,
  };
}

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

/** Confirm-card copy for stopping one exact queued/running job. */
export function describeCancelJob(job: JobRecord): { summary: string; meta: string } {
  const label = KIND_LABELS[job.type] ?? job.type;
  const num = Number.isInteger(job.params?.num) ? (job.params.num as number) : null;
  return {
    summary: num == null ? `Cancel ${label}` : `Cancel ${label} for offer #${num}`,
    meta: `job ${job.id} · graceful stop · partial output kept`,
  };
}

export function describeCreateOfferFromText(
  preview: { reused: boolean; offer: ApplicationRow | null },
  input: {
    url?: string;
    company?: string;
    role?: string;
    startKind?: TextOfferStartKind;
    modes?: string[];
  },
): { summary: string; meta: string } {
  const identity = [input.company?.trim(), input.role?.trim()].filter(Boolean).join(' · ');
  const action = preview.reused
    ? `Reuse offer #${preview.offer?.num}`
    : input.url
      ? 'Import offer from source URL'
      : 'Create offer from pasted text';
  const next = input.modes
    ? ` · then run ${input.modes.join(' → ')}`
    : input.startKind
      ? ` · then start ${KIND_LABELS[input.startKind]}`
      : '';
  return {
    summary: identity ? `${action} — ${identity}` : action,
    meta: `${preview.reused ? 'exact text match' : 'local tracker write'}${next}`,
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
