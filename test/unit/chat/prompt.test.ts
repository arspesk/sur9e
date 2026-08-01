import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODE_CATALOG } from '@/lib/modes/catalog';
import { ChatMessage } from '@/lib/schemas/chat';
import {
  buildChatSystemPrompt,
  buildTurnPrompt,
  latestVersionsOnly,
  renderTranscriptForReseed,
} from '@/lib/server/chat/prompt';

const msg = (role: 'user' | 'assistant', content: string, position: number): ChatMessage => ({
  id: `m${position}`,
  conversationId: 'c1',
  role,
  content,
  events: null,
  position,
  createdAt: '2026-07-18T00:00:00.000Z',
  versionGroup: null,
  attachments: null,
  referencedOffers: null,
});

describe('buildChatSystemPrompt', () => {
  const prompt = buildChatSystemPrompt('/tmp/root');

  it('carries the hard rules and honesty rule', () => {
    expect(prompt).toContain('Never auto-submit');
    expect(prompt).toContain('Never invent data');
    expect(prompt).toContain('confirmation');
  });

  it('routes every canonical catalog mode', () => {
    for (const mode of Object.keys(MODE_CATALOG)) {
      expect(prompt).toContain(`- ${mode} —`);
    }
  });

  it('uses durable workflows for multi-mode and selected-bulk requests', () => {
    expect(prompt).toContain('start_workflow');
    expect(prompt).toContain('list_workflows');
    expect(prompt).toContain('cancel_workflow');
    expect(prompt).toContain('dependency-aware');
    expect(prompt).toContain('one confirmation');
    expect(prompt).toContain('get_mode_instructions');
  });

  it('treats a pasted-text Screened/N/A offer as unscreened and screenable by number', () => {
    expect(prompt).toContain('source_kind: text');
    expect(prompt).toContain('source_kind: url');
    expect(prompt).toContain('score: N/A');
    expect(prompt).toContain('screen with params.num');
    expect(prompt).toContain('does not require a URL');
  });

  it('keeps screening and evaluation separate unless the user explicitly asks for both', () => {
    expect(prompt).toContain('Treat screening and evaluation as separate modes');
    expect(prompt).toContain('Create + screen');
    expect(prompt).toContain('Create + evaluate');
    expect(prompt).toContain('Create only');
    expect(prompt).toContain(
      'Use screen-evaluate only when the user explicitly asks for both screening and evaluation',
    );
    expect(prompt).not.toContain('Create + screen + evaluate (recommended)');
  });

  it('supports evaluating a URL without silently screening it first', () => {
    expect(prompt).toContain('evaluate a URL without screening');
    expect(prompt).toContain('call get_tracker first');
    expect(prompt).toContain('create_offer_from_text');
    expect(prompt).toContain('source URL');
    expect(prompt).toContain('ask for the pasted job description');
    expect(prompt).toContain('real browser/Playwright-backed reader');
    expect(prompt).toMatch(/never (?:use )?WebFetch/i);
  });

  it('checks tracked and active work before offering duplicate evaluation', () => {
    expect(prompt).toContain('Before offering or starting any offer-scoped mode');
    expect(prompt).toContain('match by tracker number, company and role, or source URL');
    expect(prompt).toContain('call get_report');
    expect(prompt).toContain('list_jobs and list_workflows');
    expect(prompt).toContain('Do not offer evaluation again');
  });

  it('requires durable Markdown links when mentioning internal app pages', () => {
    expect(prompt).toContain('[Offer #NUM](/report/NUM)');
    expect(prompt).toContain('Do not wrap an app route in inline code');
  });

  it('is provider-neutral — no vendor names', () => {
    expect(prompt).not.toMatch(/claude|codex|opencode|anthropic|openai/i);
  });
});

describe('renderTranscriptForReseed', () => {
  it('renders User:/Assistant: alternation', () => {
    const out = renderTranscriptForReseed([
      msg('user', 'hello', 0),
      msg('assistant', 'hi there', 1),
      msg('user', 'thanks', 2),
    ]);
    expect(out).toBe('User: hello\n\nAssistant: hi there\n\nUser: thanks');
  });

  it('renders empty for no messages', () => {
    expect(renderTranscriptForReseed([])).toBe('');
  });
});

describe('buildTurnPrompt', () => {
  it('resuming: just the user message', () => {
    const out = buildTurnPrompt({
      root: '/tmp/root',
      messages: [msg('user', 'earlier', 0)],
      userMessage: 'and now?',
      isResuming: true,
    });
    expect(out).toBe('and now?');
  });

  it('resuming with pageContext: appends a single trailing context line', () => {
    const out = buildTurnPrompt({
      root: '/tmp/root',
      messages: [],
      userMessage: 'and now?',
      isResuming: true,
      pageContext: 'viewing /report/12',
    });
    expect(out).toBe('and now?\n[context: viewing /report/12]');
  });

  it('fresh: static prefix first — system prompt, then transcript, then user message', () => {
    const out = buildTurnPrompt({
      root: '/tmp/root',
      messages: [msg('user', 'earlier question', 0), msg('assistant', 'earlier answer', 1)],
      userMessage: 'new question',
      isResuming: false,
      pageContext: 'viewing /offers',
    });
    const iSystem = out.indexOf('Never auto-submit');
    const iTranscript = out.indexOf('User: earlier question');
    const iNew = out.indexOf('User: new question');
    const iCtx = out.indexOf('[context: viewing /offers]');
    expect(iSystem).toBeGreaterThan(-1);
    expect(iTranscript).toBeGreaterThan(iSystem);
    expect(iNew).toBeGreaterThan(iTranscript);
    expect(iCtx).toBeGreaterThan(iNew);
  });

  it('fresh with no history: no transcript section', () => {
    const out = buildTurnPrompt({
      root: '/tmp/root',
      messages: [],
      userMessage: 'first question',
      isResuming: false,
    });
    expect(out).not.toContain('Conversation so far');
    expect(out).toContain('User: first question');
  });

  it('pageContext is flattened to one line', () => {
    const out = buildTurnPrompt({
      root: '/tmp/root',
      messages: [],
      userMessage: 'q',
      isResuming: true,
      pageContext: 'line one\nline two',
    });
    expect(out).toBe('q\n[context: line one line two]');
  });
});

describe('attachments tail', () => {
  const CONV = '11111111-2222-3333-4444-555555555555';
  const FILE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('lists verified absolute upload paths; drops hostile, foreign, and missing ones', () => {
    const root = mkdtempSync(join(tmpdir(), 'chat-prompt-att-'));
    try {
      mkdirSync(join(root, 'data', 'chat', 'uploads', CONV), { recursive: true });
      writeFileSync(join(root, 'data', 'chat', 'uploads', CONV, `${FILE}.pdf`), '%PDF');
      const good = {
        path: `${CONV}/${FILE}.pdf`,
        name: 'cv.pdf',
        mime: 'application/pdf',
        size: 4,
      };
      const p = buildTurnPrompt({
        root,
        conversationId: CONV,
        messages: [],
        userMessage: 'what is in this file?',
        isResuming: true,
        attachments: [
          good,
          // valid shape but a DIFFERENT conversation → dropped (scoping)
          { ...good, path: `${FILE}/${FILE}.pdf` },
          // traversal shape → dropped by resolveChatUploadPath
          { ...good, path: '../../secrets.pdf', name: 'x.pdf' },
          // valid shape + right conversation but no file on disk → dropped
          { ...good, path: `${CONV}/${CONV}.pdf` },
        ],
      });
      expect(p).toContain(
        `${join(root, 'data', 'chat', 'uploads', CONV, `${FILE}.pdf`)} (cv.pdf, application/pdf, 4 bytes)`,
      );
      expect(p).not.toContain('secrets');
      expect(p).not.toContain(`${FILE}/${FILE}.pdf`);
      expect(p).not.toContain(`${CONV}/${CONV}.pdf`);
      expect(p.startsWith('what is in this file?')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('omits the attachments block entirely when nothing survives verification', () => {
    const root = mkdtempSync(join(tmpdir(), 'chat-prompt-att-empty-'));
    try {
      const p = buildTurnPrompt({
        root,
        conversationId: CONV,
        messages: [],
        userMessage: 'q',
        isResuming: true,
        attachments: [{ path: '../etc/passwd', name: 'x', mime: 'text/plain', size: 1 }],
      });
      expect(p).toBe('q');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('selections tail', () => {
  it('renders a quoted block, collapsing internal whitespace per entry', () => {
    const out = buildTurnPrompt({
      root: '/tmp/root',
      messages: [],
      userMessage: 'what does this mean?',
      isResuming: true,
      selections: ['first  selected\n  chunk', 'second one'],
    });
    expect(out).toContain('[selected text the user is referring to:');
    expect(out).toContain('"first selected chunk"');
    expect(out).toContain('"second one"');
    expect(out.startsWith('what does this mean?')).toBe(true);
  });

  it('omits the block entirely when there are no selections', () => {
    const out = buildTurnPrompt({
      root: '/tmp/root',
      messages: [],
      userMessage: 'q',
      isResuming: true,
      selections: [],
    });
    expect(out).not.toContain('selected text');
  });

  it('sits AFTER referenced offers/attachments and BEFORE the context line', () => {
    const out = buildTurnPrompt({
      root: '/tmp/root',
      messages: [],
      userMessage: 'compare them',
      isResuming: true,
      referencedOffers: [48],
      selections: ['a quoted bit'],
      pageContext: 'report for offer #48 Linear',
    });
    const iRefs = out.indexOf('[referenced offers:');
    const iSel = out.indexOf('[selected text');
    const iCtx = out.indexOf('[context:');
    expect(iRefs).toBeGreaterThan(-1);
    expect(iSel).toBeGreaterThan(iRefs);
    expect(iCtx).toBeGreaterThan(iSel);
  });

  it('both selections and the semantic pageContext reach a FRESH prompt', () => {
    const out = buildTurnPrompt({
      root: '/tmp/root',
      messages: [],
      userMessage: 'q',
      isResuming: false,
      selections: ['abc def'],
      pageContext: 'offers table — 5 offers, sorted by score desc',
    });
    expect(out).toContain('"abc def"');
    expect(out).toContain('[context: offers table — 5 offers, sorted by score desc]');
    // The system prompt still leads the fresh build.
    expect(out.indexOf('Never auto-submit')).toBeLessThan(out.indexOf('"abc def"'));
  });
});

describe('referenced offers tail', () => {
  it('lists each referenced offer with its report path or a no-report note', () => {
    const root = mkdtempSync(join(tmpdir(), 'chat-prompt-refs-'));
    try {
      mkdirSync(join(root, 'artifacts', 'reports'), { recursive: true });
      writeFileSync(join(root, 'artifacts', 'reports', '048-linear-2026-07-01.md'), '# r');
      const p = buildTurnPrompt({
        root,
        messages: [],
        userMessage: 'compare them',
        isResuming: true,
        referencedOffers: [48, 99],
      });
      expect(p).toContain(
        `#48 — report: ${join(root, 'artifacts', 'reports', '048-linear-2026-07-01.md')}`,
      );
      expect(p).toContain('#99 — report: no report file on disk yet');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('latestVersionsOnly', () => {
  const msg = (id: string, position: number, versionGroup: string | null) =>
    ChatMessage.parse({
      id,
      conversationId: 'c',
      role: 'assistant',
      content: id,
      events: null,
      position,
      createdAt: '2026-01-01T00:00:00.000Z',
      versionGroup,
    });

  it('keeps ungrouped messages and only the highest-position member per group', () => {
    const messages = [msg('a', 0, null), msg('v1', 1, 'g'), msg('v2', 2, 'g'), msg('b', 3, null)];
    expect(latestVersionsOnly(messages).map(m => m.id)).toEqual(['a', 'v2', 'b']);
  });
});
