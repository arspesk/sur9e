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
// Fallback retry: when a run fails (and is NOT a timeout) and the runtime
// carries a `.fallback = {provider, model}` pair, the combined output is
// classified via cli/classify-error.mjs; a retryable category triggers ONE
// retry on the fallback pair. On fallback success the result gains a
// `usedFallback` field and a `[FALLBACK] {json}` marker is prepended to
// stdout (mirroring the `[USAGE]` marker) so the job runner can re-stamp the
// record with the model that actually ran. A double failure returns a
// combined error naming both the primary and fallback attempts.

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { classifyProviderError, isRetryable } from "../../cli/classify-error.mjs";

function defaultExec(cmd, args, opts) {
  return spawnSync(cmd, args, { encoding: "utf-8", ...opts });
}

const TERMINAL_FAILURE_GRACE_MS = 1000;

function descendantPids(pid) {
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
    spawnSync("taskkill", args, { stdio: "ignore" });
    return;
  }
  for (const childPid of descendantPids(pid)) {
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
  { logsDir, execImpl = defaultExec, runtime } = {},
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
      { cwd: rootPath },
    );
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
    let built;
    try {
      built = buildSpawnArgsForMode(rootPath, modeId, prompt, { logsDir, execImpl, runtime });
    } catch (err) {
      resolvePromise({ ok: false, error: err.message, stdout: "", stderr: "", promptText: prompt });
      return;
    }
    const child = spawnImpl(built.spawn.cmd, built.spawn.args, {
      cwd: rootPath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let stoppingCategory = null;
    let cancelled = false;
    let forceTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      signal?.removeEventListener("abort", abort);
      resolvePromise(result);
    };
    const stopGracefully = () => {
      try {
        terminateProviderTree(child, "SIGTERM");
      } catch {}
      forceTimer = setTimeout(() => {
        try {
          terminateProviderTree(child, "SIGKILL");
        } catch {}
        // A broken wrapper can fail to emit `close` even after its process
        // tree is gone. Do not turn a recognized provider failure into the
        // full mode timeout; settle from the diagnostic that initiated stop.
        const settleTimer = setTimeout(() => {
          finish(
            cancelled
              ? {
                  ok: false,
                  cancelled: true,
                  error: "cancelled",
                  stdout,
                  stderr,
                  promptText: prompt,
                }
              : {
                  ok: false,
                  error: `provider ${stoppingCategory}`,
                  failureCategory: stoppingCategory,
                  stdout,
                  stderr,
                  promptText: prompt,
                },
          );
        }, 50);
        settleTimer.unref?.();
      }, TERMINAL_FAILURE_GRACE_MS);
      forceTimer.unref?.();
    };
    const abort = () => {
      if (settled || cancelled) return;
      cancelled = true;
      stopGracefully();
    };
    const detectStreamedTerminalFailure = () => {
      if (settled || cancelled || stoppingCategory) return;
      // Provider CLIs reserve stderr for diagnostics. Restrict early
      // termination to that channel so a successful model answer that merely
      // discusses a "rate limit" cannot be mistaken for a CLI failure.
      const category = classifyProviderError(runtime?.provider ?? "claude", stderr);
      if (!isRetryable(category)) return;
      stoppingCategory = category;
      stopGracefully();
    };
    const timer = setTimeout(() => {
      try {
        terminateProviderTree(child, "SIGKILL");
      } catch {}
      finish({
        ok: false,
        error: `timeout ${timeoutMs}ms`,
        stdout,
        stderr,
        promptText: prompt,
      });
    }, timeoutMs);
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
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    child.on("close", (code) => {
      finish(
        cancelled
          ? { ok: false, cancelled: true, error: "cancelled", stdout, stderr, promptText: prompt }
          : stoppingCategory && (code === null || code === 0)
            ? {
                ok: false,
                error: `provider ${stoppingCategory}`,
                failureCategory: stoppingCategory,
                stdout,
                stderr,
                promptText: prompt,
              }
            : code === 0
          ? { ok: true, stdout, stderr, promptText: prompt }
          : { ok: false, error: `exit ${code}`, stdout, stderr, promptText: prompt },
      );
    });
    child.on("error", (err) => {
      finish({ ok: false, error: err.message, stdout, stderr, promptText: prompt });
    });
  });
}

export async function runModeLLM(rootPath, modeId, prompt, opts = {}) {
  const { runtime, tee = false } = opts;
  const first = await runOnce(rootPath, modeId, prompt, opts, runtime);
  if (first.ok) return first;
  if (first.cancelled) return first;
  // Timeouts never retry: a fallback attempt would double a multi-minute
  // hang, and a timeout is not evidence of a model-side problem.
  if (typeof first.error === "string" && first.error.startsWith("timeout")) return first;
  const fallback = runtime?.fallback;
  if (!fallback?.provider || !fallback?.model) return first;
  const combined = `${first.stderr ?? ""}\n${first.stdout ?? ""}\n${first.error ?? ""}`;
  // Classify ONCE under the primary provider. The failure text always comes
  // from the PRIMARY provider's CLI, so classifying under any other provider's
  // signature table would invite false-positive retries (e.g. job output
  // quoting a JD phrase that matches another provider's needle).
  const category =
    first.failureCategory ?? classifyProviderError(runtime?.provider ?? "claude", combined);
  if (!isRetryable(category)) return first;

  const fromTo = {
    from: { provider: runtime.provider, model: runtime.model },
    to: { provider: fallback.provider, model: fallback.model },
    reason: category,
  };
  const marker = `[FALLBACK] ${JSON.stringify(fromTo)}`;
  // Surface the marker on OUR stdout when teeing (job-record capture path);
  // it is also embedded in the returned stdout so per-run log files carry it.
  if (tee) process.stdout.write(`${marker}\n`);

  const second = await runOnce(rootPath, modeId, prompt, opts, {
    provider: fallback.provider,
    model: fallback.model,
  });
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
