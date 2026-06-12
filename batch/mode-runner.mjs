#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// batch/mode-runner.mjs
//
// Universal headless mode orchestrator (multi-provider). One spec per mode
// in batch/specs/; this file owns the shared lifecycle:
//   resolve runtime → spec.loadInputs → spec.buildPrompt → run provider CLI
//   → spec.parse(stdout) → spec.write(artifacts) → track usage
// Workers NEVER rely on provider tools for output — the deliverable arrives
// as a sentinel payload in stdout (batch/lib/output-parser.mjs) and Node
// writes every artifact. Exit codes: 0 success, 1 failure (runner.ts maps
// non-zero to job error).
//
// Usage:  node batch/mode-runner.mjs <modeId> --num <N>

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimeForMode, runModeLLM } from "./lib/llm.mjs";
import { trackModeUsage } from "./lib/usage.mjs";

const ROOT = resolve(process.cwd());
const LOGS_DIR = `${ROOT}/batch/logs/modes`;

// Lazy spec registry: import only the requested spec so a syntax error in
// one spec can't break every other mode.
const SPEC_LOADERS = {
  evaluate: () => import("./specs/evaluate.mjs"),
  research: () => import("./specs/sections.mjs").then((m) => m.researchSpec),
  "interview-prep": () => import("./specs/sections.mjs").then((m) => m.interviewPrepSpec),
  "reach-out": () => import("./specs/sections.mjs").then((m) => m.outreachSpec),
  negotiate: () => import("./specs/sections.mjs").then((m) => m.negotiateSpec),
  "tailor-cv": () => import("./specs/pdf.mjs").then((m) => m.tailorCvSpec),
  "cover-letter": () => import("./specs/pdf.mjs").then((m) => m.coverLetterSpec),
};

function normalizeModeId(modeId) {
  return modeId === "outreach" ? "reach-out" : modeId;
}

export async function runMode(spec, ctx, deps) {
  const { resolveRuntime, runLLM, trackUsage, log } = deps;
  let runtime;
  try {
    runtime = resolveRuntime(ctx.rootPath, spec.modeId);
  } catch (err) {
    log(`❌ runtime resolution failed: ${err.message}`);
    return 1;
  }
  log(
    `mode=${spec.modeId} provider=${runtime.provider} model=${runtime.model} (resolved from ${runtime.resolvedFrom})`,
  );

  let inputs;
  try {
    inputs = await spec.loadInputs(ctx);
  } catch (err) {
    log(`❌ input loading failed: ${err.message}`);
    return 1;
  }

  const prompt = spec.buildPrompt(ctx, inputs);

  function persistRunLog(result, attempt) {
    // Persist the raw worker response next to screen.mjs's per-URL logs —
    // when a model ignores the sentinel contract, the stdout is the ONLY
    // evidence of what it did instead (caught during the provider matrix:
    // codex outreach failed with nothing to diagnose from).
    try {
      mkdirSync(LOGS_DIR, { recursive: true });
      const provider = result.usedFallback
        ? `${result.usedFallback.to.provider}/${result.usedFallback.to.model} (fallback from ${runtime.provider}/${runtime.model})`
        : `${runtime.provider}/${runtime.model}`;
      // Provenance: when the spec pre-fetched a JD floor, record its status so
      // a reader can tell whether the model started from a complete page or
      // had to rely on its own live fetch. The STDOUT below carries the actual
      // tool-call lines (WebFetch / WebSearch / browser_navigate).
      const jdStatus = inputs?.jd?.status ? `JD_FLOOR: ${inputs.jd.status}\n` : '';
      writeFileSync(
        `${LOGS_DIR}/${spec.modeId}-${ctx.num}${attempt > 1 ? `-attempt${attempt}` : ''}.log`,
        `PROVIDER: ${provider}\n${jdStatus}OK: ${result.ok} ${result.error ?? ''}\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}\n`,
        'utf-8',
      );
    } catch {
      // Logging must never fail the run.
    }
  }

  function trackAttempt(result) {
    // When stream-claude-parser piped the run, it emitted an authoritative
    // [USAGE] line with REAL token counts — the job runner forwards that to
    // trackProvider on job close, so the tiktoken estimate here would
    // double-count the run. Skip the estimate and let the accurate path win.
    if (/^\[USAGE\] /m.test(result.stdout ?? "")) return;
    // Track every attempt — the tokens were spent regardless of whether the
    // run failed, the payload was malformed, or the write blew up. When the
    // run fell through to the fallback pair, label usage with the model that
    // ACTUALLY ran, not the primary we resolved.
    const actual = result.usedFallback
      ? { ...runtime, provider: result.usedFallback.to.provider, model: result.usedFallback.to.model }
      : runtime;
    try {
      trackUsage(actual, spec.modeId, result.promptText, result.stdout, {
        rootPath: ctx.rootPath,
      });
    } catch (err) {
      log(`⚠️ usage tracking failed: ${err.message}`);
    }
  }

  // SINGLE RESOLUTION: hand the already-resolved runtime to the spawn
  // builder so the label and the spawned binary cannot disagree (the
  // codex-mislabel bug class).
  let result = await runLLM(ctx.rootPath, spec.modeId, prompt, {
    timeoutMs: spec.timeoutMs,
    logsDir: LOGS_DIR,
    runtime,
    // Stream the provider's output through our own stdout so the job runner
    // (which persists mode-runner's streams into the job record) shows live
    // progress instead of a silent gap until completion.
    tee: true,
  });
  persistRunLog(result, 1);
  if (!result.ok) {
    log(`❌ LLM run failed: ${result.error}`);
    if (result.stderr) log(result.stderr.slice(-2000));
    trackAttempt(result);
    return 1;
  }

  // Parse stdout first; some CLIs (opencode TUI under certain plugins)
  // print the model transcript to STDERR while stdout carries machine
  // events — fall back to the combined streams so the deliverable is
  // found wherever the CLI put it. Sentinel extraction takes the LAST
  // marker pair, so prompt echoes earlier in either stream are harmless.
  const parseSource = (r) => `${r.stdout}\n${r.stderr ?? ""}`;
  let payload;
  let code = 0;
  try {
    payload = spec.parse(parseSource(result));
  } catch (err) {
    // One bounded retry on a CONTRACT slip only (sentinel/heading missing).
    // Models occasionally drop the markers after a long research turn —
    // codex outreach did exactly this in the provider matrix and passed
    // verbatim on the retry. Run failures/timeouts above do NOT retry
    // (they signal quota/installation problems, not formatting flakes).
    log(`⚠️ output parse failed: ${err.message} — retrying once`);
    if (result.stderr?.trim()) log(result.stderr.trim().split("\n").slice(-3).join("\n"));
    trackAttempt(result);
    result = await runLLM(ctx.rootPath, spec.modeId, prompt, {
      timeoutMs: spec.timeoutMs,
      logsDir: LOGS_DIR,
      runtime,
      tee: true,
    });
    persistRunLog(result, 2);
    if (!result.ok) {
      log(`❌ LLM retry run failed: ${result.error}`);
      trackAttempt(result);
      return 1;
    }
    try {
      payload = spec.parse(parseSource(result));
    } catch (err2) {
      log(`❌ output parse failed on retry: ${err2.message}`);
      if (result.stderr?.trim()) log(result.stderr.trim().split("\n").slice(-3).join("\n"));
      code = 1;
    }
  }

  if (code === 0) {
    try {
      const { summary } = await spec.write(ctx, inputs, payload);
      log(`✅ ${summary}`);
    } catch (err) {
      log(`❌ artifact write failed: ${err.message}`);
      code = 1;
    }
  }

  // Track the final attempt regardless of parse/write outcome — the tokens
  // were spent either way. (A retried first attempt was already tracked at
  // the retry decision point.)
  trackAttempt(result);
  return code;
}

async function mainCli() {
  const [rawModeId, ...rest] = process.argv.slice(2);
  const modeId = normalizeModeId(rawModeId);
  const numIdx = rest.indexOf("--num");
  const num = numIdx === -1 ? null : parseInt(rest[numIdx + 1], 10);
  const loader = SPEC_LOADERS[modeId];
  if (!loader) {
    console.error(
      `ERROR: unknown mode "${modeId}". Known: ${Object.keys(SPEC_LOADERS).join(", ")}`,
    );
    process.exit(1);
  }
  if (!Number.isInteger(num)) {
    console.error("ERROR: --num <offer number> is required");
    process.exit(1);
  }
  mkdirSync(LOGS_DIR, { recursive: true });
  const loaded = await loader();
  const spec = loaded.default ?? loaded;
  const ctx = { rootPath: ROOT, num };
  const code = await runMode(spec, ctx, {
    resolveRuntime: resolveRuntimeForMode,
    runLLM: runModeLLM,
    trackUsage: trackModeUsage,
    log: (msg) => console.log(msg),
  });
  process.exit(code);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mainCli().catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
}
