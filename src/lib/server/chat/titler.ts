// src/lib/server/chat/titler.ts
//
// AI thread titles. After a conversation's FIRST completed turn the runner
// fire-and-forgets generateConversationTitle: one cheap-model CLI call
// producing a concise title. applyFallbackTitle runs synchronously at first
// send so a thread never lingers as 'New chat'. Manual renames always win:
// every write goes through setAutoTitle, which refuses on 'manual'.

import 'server-only';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { Provider } from '../providers/types';
import { setAutoTitle } from './store';

const TITLE_TIMEOUT_MS = 60_000;
const TITLE_MAX_CHARS = 80;
// Explicit maxBuffer — the strings-maxBuffer lesson (commit 6d1283d1).
const TITLE_MAX_BUFFER = 10 * 1024 * 1024;
const SNIPPET_CHARS = 500;

/** Cheapest model per provider for the one-shot title call. null → reuse the
 * turn's own model (opencode ids depend on the user's configured providers —
 * no universal cheap tier). Ids come from each adapter's static list
 * (src/lib/server/providers/{claude,codex}.ts) — known-accepted. */
const TITLE_MODELS: Record<string, string | null> = {
  claude: 'claude-haiku-4-5-20251001',
  codex: 'gpt-5.4-mini',
  opencode: null,
};

type ExecImpl = (
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>;

const realExec: ExecImpl = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = execFile(cmd, args, opts, (err, stdout) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout) });
    });
    // CLOSE the child's stdin immediately (send EOF). This is THE fix for the
    // titler never landing a title on codex/opencode: `codex exec` and
    // `opencode run` both try to read "additional input" from stdin, and
    // execFile's default stdio leaves stdin as an OPEN pipe — so both CLIs
    // blocked forever waiting for EOF, hit the 60s title timeout with empty
    // stdout, and the fallback title stayed. (claude self-times-out on stdin
    // after ~3s with a warning and proceeds, so it "worked" but slowly; the
    // EOF removes that delay too.) The one-shot title prompt is passed as an
    // argv positional, never on stdin, so closing it is always safe.
    child.stdin?.end();
  });

let execImpl: ExecImpl = realExec;

/** Test hook — pass null to restore the real execFile. */
export function _setTitleExecImpl(impl: ExecImpl | null): void {
  execImpl = impl ?? realExec;
}

/** First user message → ≤80-char title with explicit dots when truncated. */
export function fallbackTitleFrom(userMessage: string): string {
  const clean = userMessage.replace(/\s+/g, ' ').trim();
  if (clean.length <= TITLE_MAX_CHARS) return clean || 'New chat';
  const contentBudget = TITLE_MAX_CHARS - 3;
  const cut = clean.slice(0, contentBudget);
  const lastSpace = cut.lastIndexOf(' ');
  const truncated = (lastSpace > contentBudget / 2 ? cut.slice(0, lastSpace) : cut).trim();
  return `${truncated}...`;
}

/** Applied synchronously at first send — 'New chat' never lingers. */
export function applyFallbackTitle(
  root: string,
  conversationId: string,
  userMessage: string,
): void {
  setAutoTitle(root, conversationId, fallbackTitleFrom(userMessage));
}

function sanitizeTitle(raw: string): string | null {
  // Scan every line for the FIRST that cleans to a plausible title (3–80
  // chars), rather than only inspecting the first non-empty line. With
  // outputFormat 'text' + CODEX_QUIET_MODE the three CLIs already put their
  // banner/telemetry on stderr and emit a clean title on stdout, so line 1 is
  // normally the title — but scanning makes the parse resilient to any stray
  // leading log line a CLI upgrade might print on stdout (which, under the old
  // first-line-only logic, would be grabbed, fail the length gate, and sink
  // the whole title even though the real title sits on the next line).
  for (const rawLine of raw.split('\n')) {
    const title = rawLine
      .trim()
      .replace(/^["'`\s]+|["'`.\s]+$/g, '')
      .replace(/\s+/g, ' ');
    if (title.length >= 3 && title.length <= TITLE_MAX_CHARS) return title;
  }
  return null;
}

/** Fire-and-forget: NEVER throws — any failure leaves the fallback title. */
export async function generateConversationTitle(opts: {
  root: string;
  conversationId: string;
  provider: Provider;
  model: string;
  userMessage: string;
  assistantReply: string;
}): Promise<void> {
  try {
    const model = TITLE_MODELS[opts.provider.id] ?? opts.model;
    const prompt =
      'Write a concise title summarizing this conversation. Reply with ONLY the title — no quotes, no trailing punctuation, no preamble.\n\n' +
      `User: ${opts.userMessage.slice(0, SNIPPET_CHARS)}\n` +
      `Assistant: ${opts.assistantReply.slice(0, SNIPPET_CHARS)}`;
    const built = opts.provider.buildHeadlessArgs({
      prompt,
      model,
      outputFormat: 'text',
      pipeToParser: false,
    });
    // Run from a NEUTRAL cwd (system temp), not opts.root. Every CLI loads the
    // project's agent context (CLAUDE.md / AGENTS.md) from its cwd — under
    // opts.root the title call becomes the full sur9e agent and answers the
    // "conversation" as a job-hunt task (long tracker analysis) instead of
    // emitting a title, which sanitizeTitle then rejects. A neutral cwd keeps
    // this a plain LLM call. env mirrors the turn-runner ({...process.env,
    // ...built.env}) so provider vars survive — codex's CODEX_QUIET_MODE
    // suppresses its banner, which would otherwise be stdout's first line.
    const { stdout } = await execImpl(built.cmd, built.args, {
      cwd: tmpdir(),
      timeout: TITLE_TIMEOUT_MS,
      maxBuffer: TITLE_MAX_BUFFER,
      env: { ...process.env, ...built.env },
    });
    const title = sanitizeTitle(stdout);
    if (title) setAutoTitle(opts.root, opts.conversationId, title);
  } catch {
    // Best-effort — the first-send fallback title stays.
  }
}
