#!/usr/bin/env node
// cli/mcp-app-server.mjs — the sur9e-app MCP server (stdio transport).
//
// Bridges an AI agent (a web-chat turn or a terminal session) to the
// running sur9e web app over HTTP. Zero dependencies by design: JSON-RPC
// 2.0, one message per line, over stdin/stdout — the MCP stdio framing
// (protocol revision 2025-06-18).
//
// Env:
//   SUR9E_APP_URL       base URL of the web app (default http://localhost:3000)
//   SUR9E_CHAT_TURN_ID  set by the chat turn runner; routes confirm cards
//                       into that turn. Empty/absent = terminal session.
//   SUR9E_ROOT          repo root (informational; every read and write
//                       goes over HTTP so src/lib/server/ stays the
//                       single source of effects)
//
// stdout carries ONLY JSON-RPC frames; all logging goes to stderr.

import { createInterface } from 'node:readline';

const APP_URL = (process.env.SUR9E_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const TURN_ID = process.env.SUR9E_CHAT_TURN_ID ?? '';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'sur9e-app', version: '1.0.0' };

const READ_TOOLS = [
  {
    name: 'get_tracker',
    description:
      'List every tracked application: num, date, company, role, score, status, report summary. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_report',
    description:
      'Full detail for one application by tracker number, including the evaluation report as markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        num: { type: 'integer', minimum: 1, description: 'Application number from the tracker' },
      },
      required: ['num'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_pipeline',
    description:
      'Screening pipeline: job URLs waiting to be screened or already screened. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_profile_summary',
    description:
      'Candidate profile summary: name, target role archetypes, search locations. Never includes the CV or contact details.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_jobs',
    description: 'Background jobs currently queued or running, grouped by job type. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// Every job kind the chat can launch (spec §2 v1 capabilities).
const JOB_KINDS = [
  'evaluate',
  'tailor-cv',
  'cover-letter',
  'research',
  'interview-prep',
  'reach-out',
  'negotiate',
  'scan',
  'batch-evaluate',
  'screen',
  'screen-evaluate',
];

const TERMINAL_APPROVED_DESC =
  'Terminal sessions only: set true ONLY after the user explicitly approved this exact ' +
  'action in the conversation. Ignored in web chat (the confirm card is the approval).';

const ACTION_TOOLS = [
  {
    name: 'start_job',
    description:
      `Start a background job (${JOB_KINDS.join(', ')}). ` +
      'ALWAYS requires user approval before anything runs or spends AI tokens — follow the instructions in the tool result.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: JOB_KINDS },
        params: {
          type: 'object',
          description:
            'Job parameters: { "num": <tracker number> } for per-offer kinds; screen or screen-evaluate with { "num": <tracker number> } for a tracked pasted-text offer (does not require a URL), or { "url": "https://…" } for a URL offer; {} for scan/batch-evaluate.',
        },
        terminalApproved: { type: 'boolean', description: TERMINAL_APPROVED_DESC },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_job',
    description:
      'Cancel ONE exact queued/running background job by id. First call list_jobs; if more than one job could match the user’s request, ask which one. ALWAYS requires user approval. Cancellation keeps logs and partial files.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          pattern: '^[a-z0-9-]{1,64}$',
          description: 'Exact id returned by list_jobs',
        },
        terminalApproved: { type: 'boolean', description: TERMINAL_APPROVED_DESC },
      },
      required: ['job_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_offer_from_text',
    description:
      'Create or reuse a normal tracked offer from pasted job-description text, without a URL. ' +
      'If company or role is missing, ask the user first; use Unknown only when the information is genuinely absent from the text. ' +
      'Unless the user already chose, ask whether they want: Create + screen + evaluate (recommended), Create + screen, or Create only. ' +
      'Exact normalized text is deduplicated. Optionally start screen + evaluate, screen, evaluate, CV, cover letter, research, interview prep, outreach, or negotiation in the SAME approval. ' +
      'ALWAYS requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          minLength: 1,
          maxLength: 32000,
          description: 'The pasted job description text',
        },
        company: { type: 'string', description: 'Company name, when known' },
        role: { type: 'string', description: 'Role title, when known' },
        start_kind: {
          type: 'string',
          enum: [
            'screen',
            'screen-evaluate',
            'evaluate',
            'tailor-cv',
            'cover-letter',
            'research',
            'interview-prep',
            'reach-out',
            'negotiate',
          ],
          description:
            'Optional job to start after creation; use screen-evaluate for the recommended Create + screen + evaluate workflow',
        },
        terminalApproved: { type: 'boolean', description: TERMINAL_APPROVED_DESC },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_status',
    description:
      'Set the tracker status of one application. ALWAYS requires user approval — follow the instructions in the tool result.',
    inputSchema: {
      type: 'object',
      properties: {
        num: { type: 'integer', minimum: 1 },
        status: {
          type: 'string',
          // Keep in sync with CANONICAL_STATUSES in src/lib/server/applications.ts.
          enum: [
            'screened',
            'evaluated',
            'applied',
            'responded',
            'interview',
            'offer',
            'rejected',
            'discarded',
          ],
        },
        terminalApproved: { type: 'boolean', description: TERMINAL_APPROVED_DESC },
      },
      required: ['num', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_report',
    description:
      'Apply ONE surgical find/replace edit to an already-generated report body (never the frontmatter). ' +
      'FIRST read the report with get_report and copy the exact text to change — old_text must match the ' +
      'report body EXACTLY and UNIQUELY (0 matches or >1 matches both fail; add surrounding context to ' +
      'disambiguate). To fully REGENERATE a report instead, re-run its mode via start_job (evaluate/research) ' +
      'with { num }. ALWAYS requires user approval: a confirmation card gates the write — after it shows, do ' +
      'NOT call this tool again; tell the user to approve or cancel it.',
    inputSchema: {
      type: 'object',
      properties: {
        num: { type: 'integer', minimum: 1, description: 'Tracker number of the report to edit' },
        old_text: {
          type: 'string',
          description: 'Exact, unique snippet of the current report body to replace',
        },
        new_text: { type: 'string', description: 'Replacement text (may be empty to delete)' },
        summary: {
          type: 'string',
          description: 'Optional human description of the change, shown on the confirmation card',
        },
        terminalApproved: { type: 'boolean', description: TERMINAL_APPROVED_DESC },
      },
      required: ['num', 'old_text', 'new_text'],
      additionalProperties: false,
    },
  },
  {
    name: 'navigate',
    description:
      'Navigate the sur9e web UI to an app route (e.g. /table, /report/1023). Web chat only.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', pattern: '^/', description: 'App-internal route starting with /' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
];

const TOOLS = [...READ_TOOLS, ...ACTION_TOOLS];

// ── JSON-RPC framing ─────────────────────────────────────────────────────────

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  write({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } });
}

/** MCP tool-result helpers: data as a single JSON text block. */
function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Fetch a web-app route. Adds the chat turn header when this server was
 * spawned for a chat turn, so action routes can target the right turn's
 * confirm cards. Rejects (TypeError) when the app is down — the
 * tools/call handler translates that into the "not reachable" hint.
 */
async function appFetch(path, init = {}) {
  const headers = { 'content-type': 'application/json', ...(init.headers ?? {}) };
  if (TURN_ID) headers['x-sur9e-turn'] = TURN_ID;
  const res = await fetch(`${APP_URL}${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const CHAT_CONFIRM_NOTE =
  'A confirmation card is now shown to the user in the chat. Do NOT call this tool again ' +
  'for this action — tell the user to approve or cancel the card, then wait for their decision.';
const TERMINAL_CONFIRM_NOTE =
  'Terminal session: ask the user directly whether to proceed with exactly this action. ' +
  'Only after an explicit yes, call the same tool again with the same arguments plus ' +
  '"terminalApproved": true. Never set it without asking first.';

/**
 * POST a confirm-gated action route and relay the outcome. In chat
 * context terminalApproved is stripped before forwarding — the in-chat
 * confirm card is the only approval path (the route enforces the same
 * rule; the guard is deliberately doubled).
 */
async function confirmGatedCall(path, body) {
  const outgoing = { ...body };
  if (TURN_ID) delete outgoing.terminalApproved;
  const { status, body: res } = await appFetch(path, {
    method: 'POST',
    body: JSON.stringify(outgoing),
  });
  if (status !== 200) {
    return errorResult(`Action failed (HTTP ${status}): ${res?.error ?? 'unknown error'}`);
  }
  if (res?.needsConfirm) {
    return textResult({
      ...res,
      instructions: TURN_ID ? CHAT_CONFIRM_NOTE : TERMINAL_CONFIRM_NOTE,
    });
  }
  return textResult(res);
}

// ── Tool dispatch ─────────────────────────────────────────────────────────

// Returns an MCP tool result, or null for a tool name not in TOOLS.
async function callTool(name, args) {
  switch (name) {
    case 'get_tracker': {
      const { status, body } = await appFetch('/api/applications');
      if (status !== 200) {
        return errorResult(
          `Failed to load the tracker (HTTP ${status}): ${body?.error ?? 'unknown error'}`,
        );
      }
      return textResult(body);
    }
    case 'get_report': {
      const num = args?.num;
      if (!Number.isInteger(num) || num < 1) {
        return errorResult('num must be a positive integer (the tracker number, e.g. 1023).');
      }
      const { status, body } = await appFetch(`/api/applications/${num}`);
      if (status === 404) return errorResult(`No application #${num} in the tracker.`);
      if (status !== 200) {
        return errorResult(
          `Failed to load application #${num} (HTTP ${status}): ${body?.error ?? 'unknown error'}`,
        );
      }
      // The detail payload embeds a rendered-html copy of the report —
      // drop it; the model only needs the markdown.
      return textResult({
        num: body.num,
        company: body.company,
        role: body.role,
        score: body.score,
        status: body.status,
        report: body.report
          ? { fileName: body.report.fileName, markdown: body.report.markdown }
          : null,
      });
    }
    case 'get_pipeline': {
      const { status, body } = await appFetch('/api/pipeline');
      if (status !== 200) {
        return errorResult(
          `Failed to load the pipeline (HTTP ${status}): ${body?.error ?? 'unknown error'}`,
        );
      }
      return textResult(body);
    }
    case 'get_profile_summary': {
      const { status, body } = await appFetch('/api/profile');
      if (status !== 200) {
        return errorResult(
          `Failed to load the profile (HTTP ${status}): ${body?.error ?? 'unknown error'}`,
        );
      }
      return textResult({
        name: body.candidate?.full_name ?? null,
        targets: body.target_roles?.archetypes ?? [],
        locations: body.search?.locations ?? [],
      });
    }
    case 'list_jobs': {
      const { status, body } = await appFetch('/api/jobs/active');
      if (status !== 200) {
        return errorResult(
          `Failed to list jobs (HTTP ${status}): ${body?.error ?? 'unknown error'}`,
        );
      }
      return textResult(body);
    }
    case 'start_job':
      return confirmGatedCall('/api/chat/actions/start-job', {
        kind: args?.kind,
        params: args?.params ?? {},
        terminalApproved: args?.terminalApproved === true,
      });
    case 'cancel_job':
      return confirmGatedCall('/api/chat/actions/cancel-job', {
        jobId: args?.job_id,
        terminalApproved: args?.terminalApproved === true,
      });
    case 'create_offer_from_text':
      return confirmGatedCall('/api/chat/actions/create-offer-from-text', {
        text: args?.text,
        company: args?.company,
        role: args?.role,
        startKind: args?.start_kind,
        terminalApproved: args?.terminalApproved === true,
      });
    case 'set_status':
      return confirmGatedCall('/api/chat/actions/set-status', {
        num: args?.num,
        status: args?.status,
        terminalApproved: args?.terminalApproved === true,
      });
    case 'edit_report':
      // Wire-shape is camelCase (oldText/newText); the tool takes snake_case
      // to match the model-facing input schema, so map here.
      return confirmGatedCall('/api/chat/actions/edit-report', {
        num: args?.num,
        oldText: args?.old_text,
        newText: args?.new_text,
        summary: args?.summary,
        terminalApproved: args?.terminalApproved === true,
      });
    case 'navigate': {
      if (!TURN_ID) {
        return errorResult(
          'navigate only works in the web chat. In a terminal session, tell the user where to look instead (e.g. "open /table in the web app").',
        );
      }
      const { status, body } = await appFetch('/api/chat/actions/navigate', {
        method: 'POST',
        body: JSON.stringify({ path: args?.path }),
      });
      if (status !== 200) {
        return errorResult(`Navigation failed (HTTP ${status}): ${body?.error ?? 'unknown error'}`);
      }
      return textResult(body);
    }
    default:
      return null;
  }
}

// ── Request handling ─────────────────────────────────────────────────────────

async function handleRequest(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    case 'ping':
      reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: TOOLS });
      return;
    case 'tools/call': {
      const name = params?.name;
      try {
        const result = await callTool(name, params?.arguments ?? {});
        if (result === null) {
          replyError(id, -32602, `unknown tool: ${name}`);
          return;
        }
        reply(id, result);
      } catch (err) {
        // fetch() rejects with TypeError when the app is down — surface a
        // clear next step instead of a stack trace.
        const unreachable = err instanceof TypeError || err?.cause?.code === 'ECONNREFUSED';
        reply(
          id,
          errorResult(
            unreachable
              ? `The sur9e web app is not reachable at ${APP_URL}. Ask the user to start it with \`npm run web\`, then try again.`
              : `Tool ${name} failed: ${err?.message ?? err}`,
          ),
        );
      }
      return;
    }
    default:
      replyError(id, -32601, `method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    replyError(null, -32700, 'parse error: messages must be single-line JSON-RPC 2.0');
    return;
  }
  if (typeof msg?.method !== 'string') return; // a response frame — nothing to do
  if (msg.id === undefined || msg.id === null) return; // notification — no reply
  void handleRequest(msg);
});
rl.on('close', () => process.exit(0));
