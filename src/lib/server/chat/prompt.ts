// src/lib/server/chat/prompt.ts
//
// Prompt assembly for chat turns (design spec §3.1/§3.5).
//
// Cache discipline: the static prefix (system prompt + transcript) always
// precedes the dynamic tail (new user message + page context), so provider-
// side prompt caching gets a stable prefix on the resend/reseed path. On a
// native resume the provider already holds the history — we send only the
// new user message (+ optional context line).

import 'server-only';
import type { ChatAttachment, ChatMessage } from '../../schemas/chat';
import { reportPathForNum } from '../reports';
import { resolveChatUploadPath } from './uploads';

// Lean persona — data arrives on demand via the sur9e-app MCP tools, NOT
// via fat context injection. Keep this static: anything per-turn belongs
// in the buildTurnPrompt dynamic tail.
const SYSTEM_PROMPT = `You are the sur9e chat assistant — the AI copilot inside the sur9e job-hunt app.
sur9e evaluates job offers against the user's real career profile, tailors CVs, and tracks every application locally on their machine.

## Honesty
- Never invent data. If a tool read comes back empty or you are unsure, say so plainly — "I don't know" beats a guess.
- Answer from tool reads, not from memory. When the user asks about their tracker, reports, profile, or pipeline, call the matching read tool first and cite what it returned.

## Tools
- Use the sur9e app tools (mcp__sur9e-app__*) for all app data and actions: read the tracker, reports, pipeline, and profile summary; start jobs; change statuses; navigate the UI.
- File tools (Read, Glob, Grep) and web tools (WebFetch, WebSearch) are read-only helpers. You cannot run shell commands or edit files from chat.
- Every job start and every status change goes through the matching app tool and requires the user's explicit confirmation. State what you intend to do, call the tool, and let the confirmation card do the gating — never claim an action happened before the tool result says so.

## Hard rules
- Never auto-submit a job application. sur9e fills, drafts, and prepares — the human clicks Submit. If asked to submit for the user, decline and explain why.
- Applying happens in the terminal: tell the user to run /sur9e apply <num> in their AI CLI. Chat does not fill application forms.
- First-run setup also happens in the terminal (npm run setup); if profile data is missing, point there.

## Mode routing
Run these as in-chat conversations using your tools when the user asks:
- enrich — the user wants to strengthen their CV or profile through a guided interview.
- offers — the user wants two or more offers compared side by side.
- tracker — the user asks about application status, counts, or history.
- patterns — the user asks about rejection patterns or how to improve targeting.
- follow-up — the user asks which applications need a follow-up or what cadence to use.
- process-queue — the user wants pending saved URLs screened and triaged.
- training — the user wants a course or certification evaluated against their goals.
- project — the user wants a portfolio project idea evaluated.

Start these as background jobs (start_job tool, confirmation required) instead of doing the work inline:
- evaluate — deep-evaluate one tracked offer (needs the offer number).
- screen — cheap-screen a job URL before evaluating deep.
- screen-evaluate — screen a URL and evaluate it if it passes.
- research — company research for one tracked offer.
- tailor-cv — tailored CV PDF for one offer.
- cover-letter — cover letter PDF for one offer.
- interview-prep — interview preparation brief for one offer.
- reach-out — outreach message drafts for one offer.
- negotiate — negotiation brief for one offer.
- scan — scan the configured job sources for new offers.
- batch-evaluate — evaluate every screened offer above the score threshold.

## Editing & regenerating reports
- Small change to an existing report → edit_report (a surgical find/replace on the report BODY; frontmatter is never touched, no AI spend). Read the report first with get_report and copy the exact text to change; old_text must match uniquely. A confirmation card gates the write.
- Full regeneration → re-run the underlying mode as a background job via start_job (evaluate or research with the offer number). When the user wants that re-run steered ("redo this with X in mind"), pass their steer as params.guidance on start_job — it is honored as extra instructions for that run.

## Style
- Be concise and concrete. Cite numbers from tool reads (offer numbers, scores, dates).
- English only. Refer to the AI layer as "AI" — never a vendor or model name.
- When an answer is better seen on a page, use the navigate tool and say where you sent the user.`;

export function buildChatSystemPrompt(_root: string): string {
  // _root is part of the signature contract (the UI/MCP plans call it with
  // the app root); the persona is fully static today, so it is unused.
  return SYSTEM_PROMPT;
}

/** Drop non-latest members of every version group (regenerated replies).
 * Only the SELECTED (= latest, highest position) version is context. */
export function latestVersionsOnly(messages: ChatMessage[]): ChatMessage[] {
  const latest = new Map<string, ChatMessage>();
  for (const m of messages) {
    if (m.versionGroup) {
      const cur = latest.get(m.versionGroup);
      if (!cur || m.position > cur.position) latest.set(m.versionGroup, m);
    }
  }
  return messages.filter(m => !m.versionGroup || latest.get(m.versionGroup) === m);
}

export function renderTranscriptForReseed(messages: ChatMessage[]): string {
  return messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
}

export function buildTurnPrompt(opts: {
  root: string;
  /** When set, attachment paths outside this conversation are dropped. */
  conversationId?: string;
  messages: ChatMessage[];
  userMessage: string;
  isResuming: boolean;
  pageContext?: string;
  attachments?: ChatAttachment[];
  referencedOffers?: number[];
  /** On-screen text selections the user staged as chips (Part 2). Rendered as
   * a quoted data block the assistant reacts to — never treated as instructions. */
  selections?: string[];
}): string {
  // Page context is a single trailing line so it can never masquerade as
  // part of the static prefix (and a multi-line context can't break the
  // [context: …] framing).
  const ctx = opts.pageContext
    ? `\n[context: ${opts.pageContext.replace(/\s+/g, ' ').trim()}]`
    : '';
  // Attachment paths are ABSOLUTE so the spawned CLI can Read them directly
  // (images, PDFs, and text all work with the provider's file-reading tool).
  // Every path is re-verified through resolveChatUploadPath (strict
  // uuid/uuid.ext shape under data/chat/uploads) and scoped to the current
  // conversation — anything else is dropped, never interpolated: the prompt
  // is what tells the CLI which files to read, so an unverified path here
  // would be an arbitrary-file-read handed to the model.
  const safeAttachments = (opts.attachments ?? []).flatMap(a => {
    if (opts.conversationId && !a.path.startsWith(`${opts.conversationId}/`)) return [];
    const resolved = resolveChatUploadPath(opts.root, a.path);
    return resolved ? [{ a, absPath: resolved.absPath }] : [];
  });
  const att = safeAttachments.length
    ? `\n[attached files — read each with your file-reading tool:\n${safeAttachments
        .map(({ a, absPath }) => `  ${absPath} (${a.name}, ${a.mime}, ${a.size} bytes)`)
        .join('\n')}\n]`
    : '';
  // Referenced offers resolve to on-disk report paths so the model reads the
  // full evaluation instead of guessing from the tracker row.
  const refs = opts.referencedOffers?.length
    ? `\n[referenced offers:\n${opts.referencedOffers
        .map(num => {
          const p = reportPathForNum(opts.root, num);
          return `  #${num} — report: ${p ?? 'no report file on disk yet'}`;
        })
        .join('\n')}\n]`
    : '';
  // Selections the user pointed at on-screen — DATA the assistant reacts to,
  // never instructions. Each entry is quoted on its own line with internal
  // whitespace collapsed; sits AFTER the referenced-offers/attachments blocks
  // and BEFORE the trailing context line.
  const sel = opts.selections?.length
    ? `\n[selected text the user is referring to:\n${opts.selections
        .map(s => `"${s.replace(/\s+/g, ' ').trim()}"`)
        .join('\n')}\n]`
    : '';
  if (opts.isResuming) {
    // The provider session already holds the system prompt and history.
    return `${opts.userMessage}${refs}${att}${sel}${ctx}`;
  }
  const transcript = renderTranscriptForReseed(latestVersionsOnly(opts.messages));
  const history = transcript ? `\n\n## Conversation so far\n\n${transcript}` : '';
  return `${buildChatSystemPrompt(opts.root)}${history}\n\nUser: ${opts.userMessage}${refs}${att}${sel}${ctx}`;
}
