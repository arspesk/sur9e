// batch/lib/llm.mjs
//
// Provider-layer LLM access for .mjs batch workers. The provider registry
// (src/lib/server/providers/registry.ts) is server-only and unimportable
// from plain node, so we shell out to two tsx-backed shims:
//   cli/resolve-mode.mjs      — {provider, model, resolvedFrom} for a modeId
//   cli/build-claude-cmd.mjs  — {cmd, args} spawn pair for any provider
// Extracted from batch/screen.mjs and generalized to any mode.
// execImpl/spawnImpl are injectable for tests.
//
// Fallback retry: when a run fails with a retryable provider error or a silent
// timeout and the runtime carries a `.fallback = {provider, model}` pair, ONE
// retry runs on the fallback pair. Each attempt has the configured provider
// timeout and the full operation is capped at two such budgets; the primary
// process tree must be gone before the fallback starts. On fallback success
// the result gains a
// `usedFallback` field and a `[FALLBACK] {json}` marker is prepended to
// stdout (mirroring the `[USAGE]` marker) so the job runner can re-stamp the
// record with the model that actually ran. A double failure returns a
// combined error naming both the primary and fallback attempts.

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyProviderError, isRetryable } from "../../cli/classify-error.mjs";

function defaultExec(cmd, args, opts) {
  if (process.platform !== "win32" && Number.isFinite(opts?.timeout) && opts.timeout > 0) {
    return spawnSync(
      process.execPath,
      [
        PROVIDER_SUPERVISOR,
        "--parent-pid",
        String(process.pid),
        "--",
        cmd,
        ...args,
      ],
      {
        encoding: "utf-8",
        ...opts,
        detached: true,
        // The supervisor converts this catchable signal into a process-group
        // SIGKILL, so a timed-out npx/tsx builder cannot leave descendants.
        killSignal: "SIGTERM",
      },
    );
  }
  return spawnSync(cmd, args, { encoding: "utf-8", ...opts });
}

const PROCESS_TREE_EXIT_GRACE_MS = 1000;
const PROCESS_TREE_POLL_MS = 10;
const STREAMED_ERROR_TAIL_CHARS = 16 * 1024;
const ISOLATED_PROVIDER_GROUP = Symbol("sur9e.isolated-provider-group");
const PROVIDER_SUPERVISOR = resolve(import.meta.dirname, "provider-supervisor.mjs");

function descendantPids(pid, { freeze = false } = {}) {
  if (!Number.isInteger(pid) || pid <= 1 || process.platform === "win32") return [];
  const found = [];
  const visited = new Set([pid]);
  const visit = (parentPid) => {
    // `ps --ppid` is GNU-only; macOS ships BSD ps. `pgrep -P` is available
    // on both supported Unix families and returns one direct child per line.
    const result = spawnSync("pgrep", ["-P", String(parentPid)], {
      encoding: "utf-8",
    });
    if (result.status !== 0) return;
    const children = String(result.stdout ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter(
        (childPid) =>
          Number.isInteger(childPid) && childPid > 1 && childPid !== process.pid && !visited.has(childPid),
    );
    for (const childPid of children) {
      visited.add(childPid);
      if (freeze) {
        try {
          process.kill(childPid, "SIGSTOP");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
      }
      visit(childPid);
      found.push(childPid);
    }
  };
  visit(pid);
  return found;
}

/** Stop the provider wrapper and every descendant it spawned. */
export function terminateProviderTree(child, signal = "SIGTERM") {
  const pid = child?.pid;
  if (process.platform === "win32" && Number.isInteger(pid)) {
    const args = ["/PID", String(pid), "/T"];
    if (signal === "SIGKILL") args.push("/F");
    const result = spawnSync("taskkill", args, { stdio: "ignore" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`taskkill failed for provider process ${pid} (exit ${result.status})`);
    }
    return [];
  }
  if (child?.[ISOLATED_PROVIDER_GROUP] && Number.isInteger(pid) && pid > 1) {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
    return [];
  }
  const canFreeze =
    signal === "SIGKILL" &&
    Number.isInteger(pid) &&
    pid > 1 &&
    typeof child?.spawnfile === "string";
  if (canFreeze) {
    try {
      // Freeze the wrapper before walking its descendants. Each descendant is
      // frozen before recursion, so no process in the tree can fork between
      // discovery and the final SIGKILL pass.
      process.kill(pid, "SIGSTOP");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  const descendants = descendantPids(pid, { freeze: canFreeze });
  for (const childPid of descendants) {
    try {
      process.kill(childPid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  try {
    child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  return descendants;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

function processGroupIsAlive(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 1 || process.platform === "win32") {
    return false;
  }
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

export function resolveRuntimeForMode(rootPath, modeId, { execImpl = defaultExec } = {}) {
  const overrideArgs = [];
  // Per-run override forwarded by runner.ts (params.platform/model →
  // SUR9E_OVERRIDE_* env). Without this the worker re-resolves from
  // config.yml and can disagree with the provider stamped on the job.
  if (process.env.SUR9E_OVERRIDE_PLATFORM && process.env.SUR9E_OVERRIDE_MODEL) {
    overrideArgs.push("--platform", process.env.SUR9E_OVERRIDE_PLATFORM);
    overrideArgs.push("--model", process.env.SUR9E_OVERRIDE_MODEL);
  }
  const result = execImpl(
    "npx",
    ["tsx", "--conditions=react-server", "cli/resolve-mode.mjs", modeId, ...overrideArgs],
    { cwd: rootPath },
  );
  if (result.status !== 0) {
    throw new Error(
      `resolve-mode.mjs failed for ${modeId} (exit ${result.status}): ${result.stderr || result.stdout || "(no output)"}`,
    );
  }
  return JSON.parse(String(result.stdout).trim());
}

export function buildSpawnArgsForMode(
  rootPath,
  modeId,
  prompt,
  { logsDir, execImpl = defaultExec, runtime, commandTimeoutMs } = {},
) {
  // Prompt goes through a tmp file: it inlines CV/profile/JD/mode bodies
  // and can be tens of KB — too big for argv across the extra shim hop.
  const tmp = `${logsDir}/.prompt-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  writeFileSync(tmp, prompt, "utf-8");
  try {
    const result = execImpl(
      "npx",
      [
        "tsx",
        "--conditions=react-server",
        "cli/build-claude-cmd.mjs",
        modeId,
        "--prompt-file",
        tmp,
        // Claude buffers `-p` output until completion under the text format —
        // a silent multi-minute gap in the job log. Route it through
        // stream-json + cli/stream-claude-parser.mjs (the adapter's default
        // when no --output-format is passed): the parser re-emits plain text
        // deltas plus "→ Tool · detail" progress lines, so the sentinel
        // payload still reaches spec.parse intact AND the log streams live.
        // Codex/opencode keep plain text: both stream natively, and codex's
        // NDJSON would JSON-escape the sentinels away from the parser.
        ...(runtime?.provider === "claude"
          ? []
          : ["--output-format", "text", "--no-pipe"]),
        "--json",
        // SINGLE RESOLUTION: when the caller already resolved the runtime
        // (mode-runner does), pass it explicitly so this shim cannot resolve
        // differently — the provider-mislabel bug class (label said codex,
        // spawn ran claude) is structurally impossible with an explicit pair.
        ...(runtime ? ["--platform", runtime.provider, "--model", runtime.model] : []),
      ],
      {
        cwd: rootPath,
        ...(Number.isFinite(commandTimeoutMs) && commandTimeoutMs > 0
          ? { timeout: commandTimeoutMs, killSignal: "SIGTERM" }
          : {}),
      },
    );
    if (result.error?.code === "ETIMEDOUT") {
      const error = new Error(`provider command build timed out after ${commandTimeoutMs}ms`);
      error.code = "ETIMEDOUT";
      throw error;
    }
    if (result.status !== 0) {
      throw new Error(
        `build-claude-cmd.mjs failed for ${modeId} (exit ${result.status}): ${result.stderr || result.stdout || "(no output)"}`,
      );
    }
    return { spawn: JSON.parse(String(result.stdout).trim()), promptText: prompt };
  } finally {
    try {
      unlinkSync(tmp);
    } catch {}
  }
}

// Single provider spawn + capture. `runtime` is the pair that actually runs
// (primary on the first call, fallback on the retry) — it is what gets passed
// to buildSpawnArgsForMode and decides the output-format branch. The public
// runModeLLM wrapper below orchestrates the optional one-shot fallback retry.
function runOnce(
  rootPath,
  modeId,
  prompt,
  {
    timeoutMs = 600000,
    logsDir,
    execImpl = defaultExec,
    spawnImpl = nodeSpawn,
    signal,
    // Echo the provider's streams to OUR stdout/stderr as they arrive, so a
    // parent that captures this process's output (the job runner persisting
    // mode-runner stdout into the job record) shows progress live. Opt-in:
    // screen.mjs runs many workers in parallel and must NOT interleave them.
    tee = false,
  } = {},
  runtime,
) {
  return new Promise((resolvePromise) => {
    const attemptDeadline = Date.now() + timeoutMs;
    let built;
    try {
      built = buildSpawnArgsForMode(rootPath, modeId, prompt, {
        logsDir,
        execImpl,
        runtime,
        commandTimeoutMs: timeoutMs,
      });
    } catch (err) {
      resolvePromise(
        err?.code === "ETIMEDOUT"
          ? {
              ok: false,
              error: `timeout ${timeoutMs}ms`,
              failureCategory: "timeout",
              stdout: "",
              stderr: "",
              promptText: prompt,
              // spawnSync cannot verify a timed-out npx/tsx descendant tree on
              // Windows. Suppress fallback rather than overlap an orphaned
              // builder with a second provider attempt.
              ...(process.platform === "win32" ? { cleanupFailed: true } : {}),
            }
          : { ok: false, error: err.message, stdout: "", stderr: "", promptText: prompt },
      );
      return;
    }
    const providerTimeoutMs = attemptDeadline - Date.now();
    if (providerTimeoutMs <= 0) {
      resolvePromise({
        ok: false,
        error: `timeout ${timeoutMs}ms`,
        failureCategory: "timeout",
        stdout: "",
        stderr: "",
        promptText: prompt,
      });
      return;
    }
    const isolateProviderGroup = process.platform !== "win32" && spawnImpl === nodeSpawn;
    const child = spawnImpl(
      isolateProviderGroup ? process.execPath : built.spawn.cmd,
      isolateProviderGroup
        ? [
            PROVIDER_SUPERVISOR,
            "--parent-pid",
            String(process.pid),
            "--",
            built.spawn.cmd,
            ...built.spawn.args,
          ]
        : built.spawn.args,
      {
        cwd: rootPath,
        stdio: ["ignore", "pipe", "pipe"],
        detached: isolateProviderGroup,
      },
    );
    if (isolateProviderGroup && Number.isInteger(child.pid) && child.pid > 1) {
      child[ISOLATED_PROVIDER_GROUP] = true;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let stoppingCategory = null;
    let stopReason = null;
    let hardStopStartedAt = 0;
    let hardStopFailed = false;
    let childClosed = false;
    let childExitCode = null;
    const trackedDescendants = new Set();
    let timer = null;
    let settleTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (settleTimer) clearTimeout(settleTimer);
      signal?.removeEventListener("abort", abort);
      resolvePromise(result);
    };

    const stoppedResult = (cleanupFailed = false) => {
      const cleanupSuffix = cleanupFailed ? "; provider process tree did not terminate" : "";
      if (stopReason === "process_exit") {
        if (cleanupFailed) {
          return {
            ok: false,
            error: `exit ${childExitCode}${cleanupSuffix}`,
            stdout,
            stderr,
            promptText: prompt,
            cleanupFailed: true,
          };
        }
        return childExitCode === 0
          ? { ok: true, stdout, stderr, promptText: prompt }
          : { ok: false, error: `exit ${childExitCode}`, stdout, stderr, promptText: prompt };
      }
      if (stopReason === "cancelled") {
        return {
          ok: false,
          cancelled: true,
          error: `cancelled${cleanupSuffix}`,
          stdout,
          stderr,
          promptText: prompt,
          ...(cleanupFailed ? { cleanupFailed: true } : {}),
        };
      }
      if (stopReason === "timeout") {
        return {
          ok: false,
          error: `timeout ${timeoutMs}ms${cleanupSuffix}`,
          failureCategory: "timeout",
          stdout,
          stderr,
          promptText: prompt,
          ...(cleanupFailed ? { cleanupFailed: true } : {}),
        };
      }
      if (childClosed && childExitCode !== null && childExitCode !== 0) {
        return {
          ok: false,
          error: `exit ${childExitCode}${cleanupSuffix}`,
          failureCategory: stoppingCategory,
          stdout,
          stderr,
          promptText: prompt,
          ...(cleanupFailed ? { cleanupFailed: true } : {}),
        };
      }
      return {
        ok: false,
        error: `provider ${stoppingCategory}${cleanupSuffix}`,
        failureCategory: stoppingCategory,
        stdout,
        stderr,
        promptText: prompt,
        ...(cleanupFailed ? { cleanupFailed: true } : {}),
      };
    };

    const settleStoppedAttempt = () => {
      if (settled || !stopReason) return;
      const descendantsAlive = [...trackedDescendants].some(processIsAlive);
      const isolatedGroupAlive =
        child[ISOLATED_PROVIDER_GROUP] && processGroupIsAlive(child.pid);
      // Real ChildProcess instances expose spawnfile. Test doubles settle via
      // their close event instead of probing an arbitrary fake pid.
      const rootAlive =
        !childClosed &&
        !child[ISOLATED_PROVIDER_GROUP] &&
        typeof child.spawnfile === "string" &&
        processIsAlive(child.pid);
      if (
        !descendantsAlive &&
        !isolatedGroupAlive &&
        !rootAlive &&
        childClosed &&
        !hardStopFailed
      ) {
        finish(stoppedResult());
        return;
      }
      if (
        hardStopStartedAt > 0 &&
        Date.now() - hardStopStartedAt >= PROCESS_TREE_EXIT_GRACE_MS
      ) {
        finish(
          stoppedResult(
            descendantsAlive ||
              isolatedGroupAlive ||
              rootAlive ||
              !childClosed ||
              hardStopFailed,
          ),
        );
        return;
      }
      settleTimer = setTimeout(settleStoppedAttempt, PROCESS_TREE_POLL_MS);
      settleTimer.unref?.();
    };

    const killTree = (killSignal) => {
      let failed = false;
      try {
        for (const pid of terminateProviderTree(child, killSignal)) trackedDescendants.add(pid);
      } catch {
        failed = true;
      }
      // The wrapper may have exited after the first traversal. Keep signaling
      // every descendant already discovered so escalation cannot lose it.
      for (const pid of trackedDescendants) {
        try {
          process.kill(pid, killSignal);
        } catch (error) {
          if (error?.code !== "ESRCH") failed = true;
        }
      }
      if (killSignal === "SIGKILL") hardStopFailed = failed;
    };

    const stopImmediately = () => {
      if (!hardStopStartedAt) hardStopStartedAt = Date.now();
      killTree("SIGKILL");
      settleStoppedAttempt();
    };

    const abort = () => {
      if (settled || stopReason === "cancelled") return;
      clearTimeout(timer);
      stopReason = "cancelled";
      stopImmediately();
    };
    const detectStreamedTerminalFailure = () => {
      if (settled || stopReason || stoppingCategory) return;
      // Provider CLIs reserve stderr for diagnostics. Restrict early
      // termination to that channel so a successful model answer that merely
      // discusses a "rate limit" cannot be mistaken for a CLI failure.
      const category = classifyProviderError(
        runtime?.provider ?? "claude",
        stderr.slice(-STREAMED_ERROR_TAIL_CHARS),
      );
      if (!isRetryable(category)) return;
      stoppingCategory = category;
      stopReason = "provider";
      clearTimeout(timer);
      stopImmediately();
    };
    timer = setTimeout(() => {
      if (settled || stopReason) return;
      stopReason = "timeout";
      stopImmediately();
    }, providerTimeoutMs);
    child.stdout.on("data", (d) => {
      const text = d.toString();
      stdout += text;
      if (tee) process.stdout.write(text);
    });
    child.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      if (tee) process.stderr.write(text);
      detectStreamedTerminalFailure();
    });
    child.on("close", (code) => {
      childClosed = true;
      childExitCode = code;
      if (stopReason) {
        settleStoppedAttempt();
        return;
      }
      if (child[ISOLATED_PROVIDER_GROUP] && processGroupIsAlive(child.pid)) {
        stopReason = "process_exit";
        stopImmediately();
        return;
      }
      finish(
        childExitCode === 0
          ? { ok: true, stdout, stderr, promptText: prompt }
          : { ok: false, error: `exit ${childExitCode}`, stdout, stderr, promptText: prompt },
      );
    });
    child.on("error", (err) => {
      if (stopReason) {
        settleStoppedAttempt();
        return;
      }
      finish({ ok: false, error: err.message, stdout, stderr, promptText: prompt });
    });
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function runModeLLM(rootPath, modeId, prompt, opts = {}) {
  const { runtime, tee = false } = opts;
  const fallback = runtime?.fallback;
  const hasFallback = Boolean(fallback?.provider && fallback?.model);
  const timeoutMs =
    Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? Math.floor(opts.timeoutMs) : 600000;
  // `timeoutMs` remains the per-provider contract (evaluate is allowed its
  // existing 15 minutes). A configured fallback gets at most one equally
  // bounded attempt, so the operation cannot outlive two provider budgets.
  const deadline = Date.now() + timeoutMs * (hasFallback ? 2 : 1);
  const first = await runOnce(
    rootPath,
    modeId,
    prompt,
    { ...opts, timeoutMs },
    runtime,
  );
  if (first.ok) return first;
  if (first.cancelled) return first;
  if (!hasFallback || first.cleanupFailed) return first;
  const combined = `${first.stderr ?? ""}\n${first.stdout ?? ""}\n${first.error ?? ""}`;
  // Classify ONCE under the primary provider. The failure text always comes
  // from the PRIMARY provider's CLI, so classifying under any other provider's
  // signature table would invite false-positive retries (e.g. job output
  // quoting a JD phrase that matches another provider's needle).
  const category =
    first.failureCategory ?? classifyProviderError(runtime?.provider ?? "claude", combined);
  if (category !== "timeout" && !isRetryable(category)) return first;

  // Cancellation can land after the first attempt settles but before the
  // retry is spawned. It must win that race and suppress fallback entirely.
  if (opts.signal?.aborted) {
    return { ...first, cancelled: true, error: "cancelled" };
  }
  const fallbackTimeoutMs = Math.min(timeoutMs, deadline - Date.now());
  if (fallbackTimeoutMs <= 0) return first;

  const fromTo = {
    from: { provider: runtime.provider, model: runtime.model },
    to: { provider: fallback.provider, model: fallback.model },
    reason: category,
  };
  const marker = `[FALLBACK] ${JSON.stringify(fromTo)}`;
  // Surface the marker on OUR stdout when teeing (job-record capture path);
  // it is also embedded in the returned stdout so per-run log files carry it.
  if (tee) process.stdout.write(`${marker}\n`);

  const second = await runOnce(
    rootPath,
    modeId,
    prompt,
    { ...opts, timeoutMs: fallbackTimeoutMs },
    { provider: fallback.provider, model: fallback.model },
  );
  if (second.cancelled) return second;
  if (!second.ok) {
    const primaryLabel = `${runtime.provider}/${runtime.model}`;
    const fallbackLabel = `${fallback.provider}/${fallback.model}`;
    const primaryDiagnostic = String(first.stderr || first.stdout || first.error || "(no output)");
    const fallbackDiagnostic = String(
      second.stderr || second.stdout || second.error || "(no output)",
    );
    return {
      ...second,
      stdout: `${marker}\n${second.stdout}`,
      stderr: `[PRIMARY ${primaryLabel}]\n${primaryDiagnostic}\n[FALLBACK ${fallbackLabel}]\n${fallbackDiagnostic}`,
      error: `primary ${primaryLabel}: ${first.error} (${category}); fallback ${fallbackLabel}: ${second.error}`,
    };
  }
  return { ...second, stdout: `${marker}\n${second.stdout}`, usedFallback: fromTo };
}
