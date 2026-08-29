// src/lib/server/jobs/runner.ts
//
// Spawn the shell command for a job and persist its lifecycle to
// data/jobs/<id>.json. No API CRUD, no command building — single
// responsibility: spawn + stream + persist.
//
// Inlined from src/server/lib/jobs.mjs.

import 'server-only';
import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeProviderFailure, isActionableCategory } from '../../provider-error-message';
import { type JobRecord } from '../../schemas/jobs';
import { ProviderId } from '../../schemas/providers';
import { cleanErrorLine, stripTerminalNoise } from '../../terminal-noise';
import { atomicWrite } from '../atomic-write';
import { withProviderCliPath } from '../providers/cli-path';
import {
  getProvider,
  type ModeRuntime,
  type RunOverride,
  resolveModeRuntime,
} from '../providers/registry';
import { normalizeReportMarkdown } from '../report-markdown';
import { parseFrontmatter, reportPathForNum, serializeFrontmatter } from '../reports';
import { buildCommand } from './command-registry';
import {
  cancelJob,
  persistJobRecord,
  readJobRecord,
  registerLiveJob,
  unregisterLiveJob,
} from './lifecycle';

const MAX_OUTPUT_BYTES = 256 * 1024; // cap stored stdout/stderr to keep JSON small

// Job types whose worker writes (or appends to) a report body keyed by
// params.num. PDF generators (tailor-cv, cover-letter) write to artifacts/output
// and scan/batch/screen don't map to a single report num, so they are excluded:
// the normalize pass only touches the report markdown these types produce.
const REPORT_WRITING_TYPES = new Set([
  'evaluate',
  'research',
  'interview-prep',
  'reach-out',
  'negotiate',
]);

// --- private persistence helpers (duplicated here to avoid a 4th shared file) ---

function jobsDir(rootPath: string): string {
  return join(rootPath, 'data/jobs');
}

function jobPath(rootPath: string, id: string): string {
  return join(jobsDir(rootPath), `${id}.json`);
}

const persist = persistJobRecord;

// ---------------------------------------------------------------------------------

type FallbackStamp = {
  from: { provider: string; model: string };
  to: { provider: string; model: string };
  reason: string;
};

/**
 * Extract the last [FALLBACK] marker a worker emitted (batch/lib/llm.mjs
 * prints one when it retried the LLM call on the fallback pair). Mirrors
 * the [USAGE] scan in the close handler. Null on absence or malformed JSON
 * — a bad marker must never fail the job. Last-marker-wins: multi-call
 * jobs (screen) may emit several; the job-level stamp means "at least one
 * call fell back".
 */
export function extractFallbackStamp(output: string): FallbackStamp | null {
  const line = output
    .split('\n')
    .reverse()
    .find(l => l.startsWith('[FALLBACK] '));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice('[FALLBACK] '.length)) as FallbackStamp;
    if (!parsed?.from?.provider || !parsed?.to?.provider || !parsed.reason) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Post-generation normalize pass. After a report-writing job finishes
 * successfully, read its report file, run the report-markdown
 * normalizer over the body (frontmatter is preserved), and atomic-write the
 * healed file back. Returns the fix log ({count, rules}) to attach to the job
 * record, or null when the job is not a report-writing 'done' job, has no
 * params.num, or its report file cannot be located/read.
 *
 * Never throws: a normalize failure must not flip a successful job to error.
 */
export function normalizeFinishedReport(
  rootPath: string,
  job: JobRecord,
): { count: number; rules: string[] } | null {
  if (job.status !== 'done') return null;
  if (!REPORT_WRITING_TYPES.has(job.type)) return null;
  const num = job.params?.num;
  if (!Number.isInteger(num)) return null;
  try {
    const filePath = reportPathForNum(rootPath, num as number);
    if (!filePath || !existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);
    const { markdown, fixes } = normalizeReportMarkdown(body);
    // Only rewrite when the normalizer actually changed something, so a clean
    // report is never needlessly re-serialized (and its .bak rotated).
    if (markdown !== body) {
      atomicWrite(filePath, serializeFrontmatter(frontmatter, markdown));
    }
    return { count: fixes.length, rules: [...new Set(fixes.map(f => f.rule))] };
  } catch (err) {
    console.warn('[jobs] failed to normalize finished report:', (err as Error).message);
    return null;
  }
}

function canonUrl(url: unknown): string | null {
  try {
    return new URL(String(url)).href;
  } catch {
    return null;
  }
}

function resolveReportNumByUrl(rootPath: string, url: string): number | null {
  const target = canonUrl(url);
  if (!target) return null;
  const reportsDir = join(rootPath, 'artifacts', 'reports');
  if (!existsSync(reportsDir)) return null;

  let best: number | null = null;
  for (const file of readdirSync(reportsDir)) {
    if (!file.endsWith('.md')) continue;
    try {
      const { frontmatter } = parseFrontmatter(readFileSync(join(reportsDir, file), 'utf-8'));
      if (canonUrl(frontmatter.url) !== target) continue;
      const num = Number(frontmatter.num);
      if (!Number.isInteger(num) || num <= 0) continue;
      if (best == null || num > best) best = num;
    } catch {
      // Legacy or malformed report files are irrelevant to URL resolution.
    }
  }
  return best;
}

/**
 * Human-readable failure cause for a non-zero exit, plus the provider-error
 * category when the worker's captured output carries a recognisable provider
 * failure. Two tiers:
 *
 *   1. Provider failure (expired OAuth session, quota, model not found, …):
 *      the tee'd CLI stream in `output` is run through the SAME classifier and
 *      templates as a chat turn (src/lib/provider-error-message.ts), so a job
 *      that died on `Failed to authenticate: OAuth session expired…` gets the
 *      "run claude auth login" line rather than that raw text or the generic
 *      `❌ LLM run failed: exit 1` (issue #120). `category` is set.
 *   2. Otherwise, the worker's own actionable cause line. Workers print it in
 *      one of two shapes: batch/screen.mjs (and the CLI arg guards) emit
 *      'ERROR: …' lines (e.g. 'ERROR: …/cv.md missing'); batch/mode-runner.mjs
 *      emits '❌ …' lines for every failure branch, e.g. '❌ output parse failed
 *      on retry: no <<<SUR9E_OUTPUT>>> sentinel…'. The LAST such line becomes
 *      the failed card's subtitle instead of the opaque 'exit 1'. ANSI escapes
 *      are stripped and leaked `<<<SUR9E_*>>>` sentinel tokens scrubbed (via
 *      cleanErrorLine); falls back to 'exit N' when no marker is present.
 *      Capped to one subtitle-sized line; the full text stays in the logs.
 *
 * A null exit code = the worker was killed by a signal (OOM / crash / an
 * external kill), not a normal non-zero exit. Say so plainly instead of the
 * opaque "exit null" — and don't classify its partial output (mirrors
 * humanize-error.ts's 'interrupted' short-circuit on the chat-turn side).
 */
export function describeWorkerFailure(
  output: string,
  code: number | null,
  provider: string = 'claude',
): { error: string; category: string | undefined } {
  const codeLabel = code === null ? 'interrupted' : `exit ${code}`;
  const noMarkerFallback =
    code === null ? 'The job was interrupted before it finished.' : `exit ${code}`;

  if (code !== null && output) {
    const { message, category } = describeProviderFailure(provider, output);
    if (isActionableCategory(category)) return { error: message, category };
  }

  // Strip terminal noise first so a cause line rendered mid-stream (or carrying
  // color codes) matches on its ERROR:/❌ prefix and doesn't leak escapes.
  const line = stripTerminalNoise(output)
    .split('\n')
    .reverse()
    .find(l => {
      const t = l.trim();
      return t.startsWith('ERROR:') || t.startsWith('❌');
    });
  if (!line) return { error: noMarkerFallback, category: undefined };
  const stripped = line
    .trim()
    .replace(/^ERROR:\s*/, '')
    .replace(/^❌️?\s*/, '');
  const msg = cleanErrorLine(stripped);
  if (!msg) return { error: noMarkerFallback, category: undefined };
  return { error: `${msg} (${codeLabel})`, category: undefined };
}

/**
 * describeWorkerFailure shaped for a JobRecord spread: `error` always, and
 * `errorCategory` only when a provider failure was recognised (so a worker-
 * level cause never carries an explicit `undefined` field on the record).
 */
function describeFailureForRecord(
  output: string,
  code: number | null,
  provider: string | undefined,
): { error: string; errorCategory?: string } {
  const { error, category } = describeWorkerFailure(output, code, provider ?? 'claude');
  return category ? { error, errorCategory: category } : { error };
}

/** The subtitle string alone — see describeWorkerFailure. */
export function workerErrorFromOutput(
  output: string,
  code: number | null,
  provider: string = 'claude',
): string {
  return describeWorkerFailure(output, code, provider).error;
}

/**
 * Single-URL screen jobs start with params.url only. After screen.mjs writes a
 * report and merge-tracker inserts the row, attach params.num so the terminal
 * loading card's "View report" button can navigate to /report/:num.
 */
export function stampScreenJobNum(rootPath: string, job: JobRecord): JobRecord {
  if (job.status !== 'done') return job;
  if (job.type !== 'screen' && job.type !== 'screen-evaluate') return job;
  if (Number.isInteger(job.params?.num)) return job;
  const url = job.params?.url;
  if (typeof url !== 'string') return job;

  const num = resolveReportNumByUrl(rootPath, url);
  if (num == null) return job;
  return { ...job, params: { ...job.params, num } };
}

/**
 * Spawn the shell command for the given job, streaming output into
 * data/jobs/<id>.json and flipping status to 'done' or 'error' on
 * close. Returns void — callers poll the persisted record via getJob().
 *
 * Async: the running-record stamp includes provider/model metadata,
 * which requires `await getProvider(...).checkInstalled()`
 * for the `providerVersion` field. The actual checkInstalled implementation
 * is sync under the hood (execFileSync) so the await resolves immediately;
 * the callsite (api.ts) fires this via `setImmediate(() => spawnJob(...))`
 * and ignores the return value, so the async signature is invisible to
 * existing callers. If checkInstalled fails (claude binary missing) the
 * providerVersion field is left undefined — it's `.optional()` on the
 * schema specifically to tolerate this path.
 */
type SpawnedJobProcess = ChildProcess & {
  stdout: NonNullable<ChildProcess['stdout']>;
  stderr: NonNullable<ChildProcess['stderr']>;
};

type TrackUsage = (
  provider: NonNullable<JobRecord['provider']>,
  inputTokens: number,
  outputTokens: number,
  options: {
    cost_usd?: number;
    model?: string;
    mode: string;
    rootPath: string;
    estimated: boolean;
  },
) => unknown;

interface SpawnJobDeps {
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => SpawnedJobProcess;
  cancel?: typeof cancelJob;
  trackUsage?: TrackUsage;
  startNextJob?: (
    rootPath: string,
    kind: 'evaluate',
    params: Record<string, unknown>,
  ) =>
    | JobRecord
    | { conflict: true; message: string }
    | Promise<JobRecord | { conflict: true; message: string }>;
  advanceWorkflow?: (rootPath: string, jobId: string) => unknown | Promise<unknown>;
}

async function startNextJob(
  rootPath: string,
  kind: 'evaluate',
  params: Record<string, unknown>,
): Promise<JobRecord | { conflict: true; message: string }> {
  // Dynamic import avoids a static runner → start → api → runner cycle.
  const { startJob } = await import('./start');
  return startJob(rootPath, { kind, params });
}

async function advanceWorkflowForJob(rootPath: string, jobId: string): Promise<void> {
  const { advanceWorkflowsForJob } = await import('../workflows/api');
  advanceWorkflowsForJob(rootPath, jobId);
}

async function notifyWorkflow(rootPath: string, job: JobRecord, deps: SpawnJobDeps): Promise<void> {
  const persisted = readJobRecord(rootPath, job.id);
  if (!persisted?.workflowId && typeof persisted?.params.workflow_id !== 'string') return;
  try {
    await (deps.advanceWorkflow ?? advanceWorkflowForJob)(rootPath, job.id);
  } catch {
    // The child job record is authoritative. Boot/list reconciliation retries
    // advancing its parent without turning this completed child into a crash.
  }
}

export async function spawnJob(
  rootPath: string,
  job: JobRecord,
  deps: SpawnJobDeps = {},
): Promise<void> {
  if (readJobRecord(rootPath, job.id)?.status === 'cancelled') return;
  let built: ReturnType<typeof buildCommand>;
  try {
    built = buildCommand(job.type, job.params, rootPath);
  } catch (err) {
    // Adapter throws (e.g. unsupported option for the resolved provider,
    // binary missing) surface here. Persist them as the job's error rather
    // than crashing the setImmediate callback.
    const failed: JobRecord = {
      ...job,
      status: 'error',
      error: (err as Error).message,
      finishedAt: new Date().toISOString(),
    };
    persist(rootPath, failed);
    await notifyWorkflow(rootPath, failed, deps);
    return;
  }
  if (!built) {
    const failed: JobRecord = {
      ...job,
      status: 'error',
      error: `invalid job: type=${job.type}`,
      finishedAt: new Date().toISOString(),
    };
    persist(rootPath, failed);
    await notifyWorkflow(rootPath, failed, deps);
    return;
  }

  // Stamp the resolved provider runtime onto the record so the analytics
  // surface can attribute spend per-provider and the UI
  // can render "claude · sonnet-4-6 · resolved from fallback" etc.
  // job.type IS the modeId in our convention (the JobType enum mirrors the
  // mode-file basenames for claude-spawning types; scan / batch-evaluate
  // also map cleanly since the manifest has batch-evaluate.md, and scan
  // falls through to the global default via the resolveModeRuntime
  // waterfall).
  // Per-job override via params.platform + params.model — forwarded to the
  // spawned worker via SUR9E_OVERRIDE_* env below so the worker's mode
  // resolution matches the runtime stamped here. When BOTH fields are
  // present on params, they take precedence over config.yml.
  const overrideParams = (job.params || {}) as Record<string, unknown>;
  const overridePlatform = overrideParams.platform;
  const overrideModel = overrideParams.model;
  let runOverride: RunOverride | undefined;
  let runtime: ModeRuntime;
  try {
    if (
      typeof overridePlatform === 'string' &&
      overridePlatform &&
      typeof overrideModel === 'string' &&
      overrideModel
    ) {
      // Per-run params arrive unvalidated from the action/route layer —
      // reject a bogus platform here instead of casting it onto the record
      // (an invalid `provider` makes JobRecord.parse fail on every read,
      // turning the job invisible to getJob/findActiveJob).
      const parsedPlatform = ProviderId.safeParse(overridePlatform);
      if (!parsedPlatform.success) {
        throw new Error(`invalid provider override: ${overridePlatform}`);
      }
      runOverride = { platform: parsedPlatform.data, model: overrideModel };
    }
    // resolveModeRuntime throws on an invalid model id (per-run override or
    // hand-edited config.yml). Persist that as the job's error — otherwise
    // the setImmediate callback in api.ts rejects unhandled and the record
    // stays 'queued' forever, blocking singleton kinds (scan/screen/...).
    runtime = resolveModeRuntime(rootPath, job.type, runOverride);
    // Config-sourced platforms reach here via raw casts in registry.ts
    // (loadConfigShallow deliberately skips the settings schema) — a
    // hand-edited config.yml `platform:` would otherwise be stamped onto
    // the persisted record, where it fails JobRecord.parse on every read
    // and turns the job invisible to getJob/findActiveJob.
    if (!ProviderId.safeParse(runtime.provider).success) {
      throw new Error(`invalid provider in config: ${String(runtime.provider)}`);
    }
  } catch (err) {
    const failed: JobRecord = {
      ...job,
      status: 'error',
      error: (err as Error).message,
      finishedAt: new Date().toISOString(),
    };
    persist(rootPath, failed);
    await notifyWorkflow(rootPath, failed, deps);
    return;
  }
  let providerVersion: string | undefined;
  try {
    const installed = await getProvider(runtime.provider).checkInstalled();
    providerVersion = installed.ok ? installed.version : undefined;
  } catch {
    // Adapter missing or checkInstalled threw — leave version undefined;
    // the field is optional on JobRecord specifically for this
    // graceful-degradation case.
    providerVersion = undefined;
  }
  const running: JobRecord = {
    ...job,
    status: 'running',
    provider: runtime.provider,
    providerVersion,
    model: runtime.model,
    modeId: job.type,
    resolvedFrom: runtime.resolvedFrom,
  };
  if (readJobRecord(rootPath, job.id)?.status === 'cancelled') return;
  persist(rootPath, running);

  // Use a mutable reference so inner closures can update the live record.
  let current: JobRecord = running;

  // Forward the per-run override into the spawned worker's env so batch
  // scripts (screen.mjs, future workers) can call
  // cli/resolve-mode.mjs with the right `--platform`/`--model` and
  // bypass the config.yml fallthrough. The runner already used the
  // override above for the JOB RECORD stamping; this propagates it to
  // the subprocess so the actual CLI invocation matches.
  const childEnv = withProviderCliPath();
  if (runOverride) {
    childEnv.SUR9E_OVERRIDE_PLATFORM = runOverride.platform;
    childEnv.SUR9E_OVERRIDE_MODEL = runOverride.model;
  }
  // Optional free-text steer for a regeneration ("redo this with X in mind").
  // Forwarded via env (never interpolated into the bash command string) so an
  // arbitrary guidance string can't break out of the shell; mode-runner.mjs
  // reads SUR9E_GUIDANCE and appends it to the assembled mode prompt.
  const guidance = (job.params as Record<string, unknown> | undefined)?.guidance;
  if (typeof guidance === 'string' && guidance.trim()) {
    childEnv.SUR9E_GUIDANCE = guidance;
  }
  const child = (deps.spawnProcess ?? spawn)(built.cmd, built.args, {
    cwd: rootPath,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  }) as SpawnedJobProcess;
  registerLiveJob(job.id, child);

  const cancelledDuringSpawn = readJobRecord(rootPath, job.id);
  const childIdentity =
    typeof child.pid === 'number'
      ? {
          pid: child.pid,
          ...(process.platform !== 'win32' ? { processGroupId: child.pid } : {}),
        }
      : {};

  // Stamp the worker pid onto the running record. The lifecycle below is
  // flipped to done/error exclusively by this process's close/error
  // handlers — if the server dies mid-job they never fire and the record
  // would stay 'running' forever. The pid lets the read path (api.ts
  // reap-on-read via jobs/stale.ts) probe whether the worker still exists
  // and flip orphaned records to a terminal 'interrupted' error.
  // Re-read BEFORE writing the pid: cancelJob can land after the pre-spawn
  // running stamp but before registerLiveJob. Never overwrite that terminal
  // decision with the runner's stale local "running" copy.
  if (cancelledDuringSpawn?.status === 'cancelled') {
    current = {
      ...current,
      ...childIdentity,
      status: 'cancelled',
      error: null,
      finishedAt: cancelledDuringSpawn.finishedAt ?? new Date().toISOString(),
    };
    persist(rootPath, current);
    (deps.cancel ?? cancelJob)(rootPath, job.id);
  } else if (typeof child.pid === 'number') {
    current = {
      ...current,
      ...childIdentity,
    };
    persist(rootPath, current);
  }

  // Throttle persistence: collect output, write at most every 500ms.
  function persistCurrentPreservingCancellation(): void {
    const persisted = readJobRecord(rootPath, job.id);
    if (persisted?.status === 'cancelled' && current.status !== 'cancelled') {
      current = {
        ...current,
        status: 'cancelled',
        error: null,
        finishedAt: persisted.finishedAt ?? new Date().toISOString(),
      };
    }
    persist(rootPath, current);
  }

  let pending = false;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  function schedulePersist(): void {
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      if (pending) {
        pending = false;
        persistCurrentPreservingCancellation();
      }
    }, 500);
  }
  function append(chunk: string): void {
    // Sanitize BEFORE persisting so the stored record — read by the client
    // log view AND scanned here for [USAGE]/[FALLBACK]/ERROR/❌ markers — is
    // free of ANSI/OSC terminal noise (the tee'd provider stream is escape-
    // laden). Stripping per-chunk can miss an escape split across a chunk
    // boundary; the client's sanitizeJobLogLines re-strips the reassembled
    // output as a second line of defense.
    const clean = stripTerminalNoise(chunk);
    if (current.output.length + clean.length > MAX_OUTPUT_BYTES) {
      // Truncate from the head: keep the tail (most useful for "what just happened").
      const overflow = current.output.length + clean.length - MAX_OUTPUT_BYTES;
      current = { ...current, output: current.output.slice(overflow) + clean };
    } else {
      current = { ...current, output: current.output + clean };
    }
    pending = true;
    schedulePersist();
  }

  child.stdout.on('data', (d: Buffer) => append(d.toString()));
  child.stderr.on('data', (d: Buffer) => append(d.toString()));

  child.on('close', async (code: number | null) => {
    unregisterLiveJob(job.id);
    if (scheduled) {
      clearTimeout(scheduled);
      scheduled = null;
    }
    // Preserve null semantics from the .mjs: code === null means the process
    // was killed by a signal (no numeric exit). Don't coalesce to -1 — that
    // collides with legitimate exit codes and confuses downstream consumers.
    const persisted = readJobRecord(rootPath, job.id);
    current =
      persisted?.status === 'cancelled'
        ? {
            ...current,
            status: 'cancelled',
            error: null,
            exitCode: code,
            finishedAt: persisted.finishedAt ?? new Date().toISOString(),
          }
        : {
            ...current,
            exitCode: code,
            status: code === 0 ? 'done' : 'error',
            ...(code === 0
              ? { error: null }
              : describeFailureForRecord(current.output, code, current.provider)),
            finishedAt: new Date().toISOString(),
          };
    // Fallback re-stamp: when the worker retried on the fallback pair, the
    // provider/model stamped at spawn time describe the FAILED primary.
    // Flip the record to the pair that actually ran and keep the primary in
    // `fallback.from` so the UI can show "claude·opus → codex·gpt-5".
    // Placed BEFORE the [USAGE] scan so spend attribution uses the actual
    // pair via current.provider / current.model.
    const fallbackStamp = extractFallbackStamp(current.output);
    if (fallbackStamp) {
      // The marker's providers are untrusted strings; parse through the
      // ProviderId enum so the record stays well-typed (and a bogus provider
      // id from a malformed worker simply skips the re-stamp).
      const toProvider = ProviderId.safeParse(fallbackStamp.to.provider);
      const fromProvider = ProviderId.safeParse(fallbackStamp.from.provider);
      if (toProvider.success && fromProvider.success) {
        current = {
          ...current,
          provider: toProvider.data,
          model: fallbackStamp.to.model,
          fallback: {
            from: { provider: fromProvider.data, model: fallbackStamp.from.model },
            reason: fallbackStamp.reason,
          },
        };
      }
    }
    // If the spawned process emitted a [USAGE] marker (stream-claude-parser
    // does this on a successful 'result' event; the codex parser does the same
    // on turn.completed), forward into trackProvider so the analytics page can
    // show real per-mode/per-provider spend. This is the only path through
    // which non-screen modes register cost in usage.json.
    //
    // Track regardless of final job.status — when the post-CLI steps
    // (e.g. merge-tracker) crash or exit non-zero, the API tokens were
    // still consumed and we still need to record them. The user's wallet
    // doesn't care whether the merge step succeeded.
    if (current.output) {
      const usageLine = current.output
        .split('\n')
        .reverse()
        .find((l: string) => l.startsWith('[USAGE] '));
      if (usageLine) {
        try {
          const u = JSON.parse(usageLine.slice('[USAGE] '.length)) as {
            input_tokens?: number;
            output_tokens?: number;
            cost_usd?: number;
            model?: string;
          };
          const trackProvider =
            deps.trackUsage ??
            ((await import('../../../../cli/usage-tracker.mjs')).trackProvider as TrackUsage);
          // Pass rootPath explicitly: Turbopack bundles usage-tracker.mjs and
          // strips import.meta.dirname, so without this the tracker writes to
          // <repo>/../data/usage.json (one dir above the repo). See the
          // resolveUsagePath() comment in cli/usage-tracker.mjs.
          //
          // current.provider is set on the running record for jobs that
          // carry provider-routing metadata. Older records on disk lack it —
          // default to 'claude' since that's what they implicitly were.
          await trackProvider(
            current.provider ?? 'claude',
            u.input_tokens || 0,
            u.output_tokens || 0,
            {
              cost_usd: u.cost_usd ?? undefined,
              model: u.model || current.model,
              mode: current.modeId ?? current.type,
              rootPath,
              estimated: false, // [USAGE] from a real CLI is exact, not estimated
            },
          );
        } catch (err) {
          // Don't fail the job over telemetry — log and move on.
          console.warn('[jobs] failed to track usage:', (err as Error).message);
        }
      }
    }

    current = stampScreenJobNum(rootPath, current);

    // Post-generation normalize pass: heal the report markdown the worker just
    // wrote and record the fix log on the job. Only fires for report-writing
    // 'done' jobs; never throws (telemetry-grade side effect).
    const fixLog = normalizeFinishedReport(rootPath, current);
    if (fixLog) {
      current = { ...current, fixes: fixLog };
    }
    persistCurrentPreservingCancellation();

    // Chat's explicit "screen and evaluate" request is represented as two
    // real jobs, not the legacy monolithic screen-evaluate command. The screen
    // record carries `then: evaluate`; only a successful screen may create the
    // successor. stampScreenJobNum above resolves the tracker number for URL
    // screens before this hand-off.
    if (
      current.status === 'done' &&
      current.type === 'screen' &&
      current.params.then === 'evaluate' &&
      typeof current.params.next_job_id !== 'string'
    ) {
      const num = current.params.num;
      try {
        if (!Number.isInteger(num)) {
          throw new Error('screening finished without a tracker offer number');
        }
        const next = await (deps.startNextJob ?? startNextJob)(rootPath, 'evaluate', {
          num: num as number,
        });
        current =
          'conflict' in next
            ? {
                ...current,
                params: { ...current.params, continuation_error: next.message },
              }
            : {
                ...current,
                params: { ...current.params, next_job_id: next.id },
              };
      } catch (error) {
        current = {
          ...current,
          params: {
            ...current.params,
            continuation_error:
              error instanceof Error ? error.message : 'failed to start evaluation',
          },
        };
      }
      persistCurrentPreservingCancellation();
    }
    await notifyWorkflow(rootPath, current, deps);
  });

  child.on('error', (err: Error) => {
    unregisterLiveJob(job.id);
    if (scheduled) {
      clearTimeout(scheduled);
      scheduled = null;
    }
    const persisted = readJobRecord(rootPath, job.id);
    current =
      persisted?.status === 'cancelled'
        ? {
            ...current,
            status: 'cancelled',
            error: null,
            finishedAt: persisted.finishedAt ?? new Date().toISOString(),
          }
        : {
            ...current,
            status: 'error',
            error: err.message,
            finishedAt: new Date().toISOString(),
          };
    persist(rootPath, current);
    void notifyWorkflow(rootPath, current, deps);
  });
}

export type { JobRecord } from '../../schemas/jobs';
