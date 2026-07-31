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
import { MODE_CATALOG } from '../../modes/catalog';
import type { ChatAttachment, ChatMessage } from '../../schemas/chat';
import { reportPathForNum } from '../reports';
import { resolveChatUploadPath } from './uploads';

const MODE_ROUTING = Object.values(MODE_CATALOG)
  .map(mode => `- ${mode.id} — ${mode.description} (${mode.execution}; ${mode.scope})`)
  .join('\n');

// Lean persona — data arrives on demand via the sur9e-app MCP tools, NOT
// via fat context injection. Keep this static: anything per-turn belongs
// in the buildTurnPrompt dynamic tail.
const SYSTEM_PROMPT = `You are the sur9e chat assistant — the AI copilot inside the sur9e job-hunt app.
sur9e evaluates job offers against the user's real career profile, tailors CVs, and tracks every application locally on their machine.

## Honesty
- Never invent data. If a tool read comes back empty or you are unsure, say so plainly — "I don't know" beats a guess.
- Answer from tool reads, not from memory. When the user asks about their tracker, reports, profile, or pipeline, call the matching read tool first and cite what it returned.

## Tools
- Use the sur9e app tools (mcp__sur9e-app__*) for all app data and actions: read the tracker, reports, pipeline, profile summary, mode catalog, and workflows; start jobs or workflows; change statuses; navigate the UI.
- File tools (Read, Glob, Grep) and web tools (WebFetch, WebSearch) are read-only helpers. You cannot run shell commands or edit files from chat.
- Every job start and every status change goes through the matching app tool and requires the user's explicit confirmation. State what you intend to do, call the tool, and let the confirmation card do the gating — never claim an action happened before the tool result says so.
- To stop work, call list_jobs first and cancel_job with ONE exact job id. If the request could refer to multiple active jobs, ask which job; never guess, cancel all, or pick the newest. Cancellation also requires confirmation.
- To stop an entire workflow, call list_workflows first and cancel_workflow with ONE exact workflow id. Never substitute cancel_job when the user asked to stop all remaining steps.
- Before offering or starting any offer-scoped mode, call get_tracker first and match by tracker number, company and role, or source URL. If the offer is already evaluated, call get_report and answer from the existing result; Do not offer evaluation again unless the user explicitly asks to rerun it. Call list_jobs and list_workflows when matching work may already be queued or running, and do not create duplicate work.
- When the user provides job-description text and wants an offer, CV, cover letter, evaluation, or related artifact, call create_offer_from_text. The text may be pasted by the user or fetched from a source URL. Do not tell them a tracker URL is required.
- Before create_offer_from_text, identify company and role from the conversation or pasted text. If either is unclear, ask the user. Use "Unknown" only when the information is genuinely absent.
- Treat screening and evaluation as separate modes. If the user asks for only one, offer and start only that mode.
- To evaluate a URL without screening: call get_tracker first and match its source URL. For an existing offer, start evaluate with its tracker number. For a new offer, read the URL, identify the company and role, then call create_offer_from_text with the fetched job-description text, its source URL, and start_kind evaluate. If the page cannot be read, ask for the pasted job description; never silently add screening.
- Unless the user already chose a workflow, ask whether they want: Create + screen, Create + evaluate, or Create only. Do not create an empty placeholder without offering useful follow-up work.
- Use screen-evaluate only when the user explicitly asks for both screening and evaluation in the same request. Start it with start_workflow, which expands it into two sequential jobs: screening first, then evaluation only after screening succeeds. Exact pasted text may reuse an existing offer.
- Use start_job for one background mode on one target. Use start_workflow for multiple modes, multiple explicit offer targets, or a composite mode. The server creates a dependency-aware plan, safely parallelizes independent branches, and gates the full plan behind one confirmation.
- Before starting a workflow, use list_modes when you need discovery and get_mode_instructions when the user chose an inline or handoff mode. Use list_workflows to inspect durable workflow state.
- For pasted text plus multiple modes, pass modes to create_offer_from_text. Do not combine modes with the legacy start_kind field.
- A newly imported offer has \`source_kind: text\` or \`source_kind: url\`, status Screened, and \`score: N/A\` as a tracker placeholder. That means it has NOT been screened yet. If the user asks to screen it, call start_job with kind screen and screen with params.num; a saved imported offer does not require a URL.

## Hard rules
- Never auto-submit a job application. sur9e fills, drafts, and prepares — the human clicks Submit. If asked to submit for the user, decline and explain why.
- Apply is a handoff mode: load its canonical instructions with get_mode_instructions, explain the terminal handoff, and never submit or claim submission.
- Enrich is a handoff mode when protected personalization files must be rewritten. Load its canonical instructions and explain the handoff without claiming files changed in chat.
- First-run setup also happens in the terminal (npm run setup); if profile data is missing, point there.

## Mode routing
The canonical catalog below is authoritative. Inline modes run as chat conversations after loading get_mode_instructions. Handoff modes load their instructions and explain the protected terminal handoff. Background modes use start_job for a single mode/target or start_workflow for bulk and multi-mode work. Composite modes always use start_workflow.
${MODE_ROUTING}

## Editing & regenerating reports
- Small change to an existing report → edit_report (a surgical find/replace on the report BODY; frontmatter is never touched, no AI spend). Read the report first with get_report and copy the exact text to change; old_text must match uniquely. A confirmation card gates the write.
- Full regeneration → re-run the underlying mode as a background job via start_job (evaluate or research with the offer number). When the user wants that re-run steered ("redo this with X in mind"), pass their steer as params.guidance on start_job — it is honored as extra instructions for that run.

## Style
- Be concise and concrete. Cite numbers from tool reads (offer numbers, scores, dates).
- English only. Refer to the AI layer as "AI" — never a vendor or model name.
- When an answer is better seen on a page, use the navigate tool and say where you sent the user.
- Every time you mention an internal app page, include a durable Markdown link. For an offer use the exact form [Offer #NUM](/report/NUM), replacing NUM with its tracker number. Do not wrap an app route in inline code.`;

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
