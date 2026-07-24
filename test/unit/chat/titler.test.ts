import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeChatDb } from '@/lib/server/chat/db';
import { createConversation, getConversation, renameConversation } from '@/lib/server/chat/store';
import {
  _setTitleExecImpl,
  applyFallbackTitle,
  fallbackTitleFrom,
  generateConversationTitle,
} from '@/lib/server/chat/titler';
import { getProvider } from '@/lib/server/providers/registry';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chat-titler-'));
});
afterEach(() => {
  _setTitleExecImpl(null);
  closeChatDb(root);
  rmSync(root, { recursive: true, force: true });
});

const baseOpts = (conversationId: string) => ({
  root,
  conversationId,
  provider: getProvider('claude'),
  model: 'claude-sonnet-4-6',
  userMessage: 'u',
  assistantReply: 'a',
});

describe('fallbackTitleFrom', () => {
  it('short messages pass through', () => {
    expect(fallbackTitleFrom('Compare my offers')).toBe('Compare my offers');
  });
  it('long messages truncate at a word boundary within 40 chars', () => {
    const t = fallbackTitleFrom(
      'Please compare the Attio offer against the Linear offer in detail',
    );
    expect(t.length).toBeLessThanOrEqual(40);
    expect(t).toBe('Please compare the Attio offer against');
  });
  it('whitespace-only input degrades to New chat', () => {
    expect(fallbackTitleFrom('   ')).toBe('New chat');
  });
});

describe('generateConversationTitle', () => {
  it('writes a sanitized AI title over the fallback', async () => {
    const c = createConversation(root);
    applyFallbackTitle(root, c.id, 'first message text');
    _setTitleExecImpl(async () => ({ stdout: '"Offer Comparison Deep Dive."\n' }));
    await generateConversationTitle(baseOpts(c.id));
    expect(getConversation(root, c.id)?.title).toBe('Offer Comparison Deep Dive');
  });
  it('never overwrites a manual rename', async () => {
    const c = createConversation(root);
    renameConversation(root, c.id, 'My name');
    _setTitleExecImpl(async () => ({ stdout: 'AI Title Here' }));
    await generateConversationTitle(baseOpts(c.id));
    expect(getConversation(root, c.id)?.title).toBe('My name');
  });
  it('a throwing CLI leaves the fallback title untouched', async () => {
    const c = createConversation(root);
    applyFallbackTitle(root, c.id, 'keep me');
    _setTitleExecImpl(async () => {
      throw new Error('boom');
    });
    await generateConversationTitle(baseOpts(c.id));
    expect(getConversation(root, c.id)?.title).toBe('keep me');
  });

  it('a title call that times out with EMPTY stdout keeps the fallback', async () => {
    // The exact failure the stdin fix prevents: a hung codex/opencode run is
    // killed at the timeout and comes back with empty stdout. sanitizeTitle
    // rejects it → the fallback stays (never an empty/garbage title).
    const c = createConversation(root);
    applyFallbackTitle(root, c.id, 'keep me too');
    _setTitleExecImpl(async () => ({ stdout: '' }));
    await generateConversationTitle(baseOpts(c.id));
    expect(getConversation(root, c.id)?.title).toBe('keep me too');
  });

  // Real raw stdout captured live (2026-07-23) from each provider's exact
  // one-shot title command, run from a neutral cwd with stdin closed. With
  // outputFormat 'text' (+ CODEX_QUIET_MODE for codex) every CLI puts its
  // banner/telemetry on STDERR and emits only the title on STDOUT, so the
  // fixture is a clean title line. Guards the parse against a provider drift.
  type ProviderId = Parameters<typeof getProvider>[0];
  const realOutputs: Array<[ProviderId, string, string]> = [
    // [providerId, raw stdout, expected sanitized title]
    [
      'claude',
      'Matching Job Offers to Professional Background\n',
      'Matching Job Offers to Professional Background',
    ],
    ['codex', 'Strongest Offer Match\n', 'Strongest Offer Match'],
    [
      'opencode',
      'Attio Senior Engineer strongest match\n',
      'Attio Senior Engineer strongest match',
    ],
  ];
  for (const [providerId, rawStdout, expected] of realOutputs) {
    it(`sanitizes real ${providerId} title output → "${expected}"`, async () => {
      const c = createConversation(root);
      applyFallbackTitle(root, c.id, 'fallback');
      _setTitleExecImpl(async () => ({ stdout: rawStdout }));
      await generateConversationTitle({ ...baseOpts(c.id), provider: getProvider(providerId) });
      expect(getConversation(root, c.id)?.title).toBe(expected);
    });
  }

  it('scans past a stray leading stdout line to find the real title', async () => {
    // Resilience: if a CLI ever prints a stray log line on stdout BEFORE the
    // title, the scan finds the title on a later line instead of rejecting on
    // the (out-of-range) first line the way the old first-line-only logic did.
    const c = createConversation(root);
    applyFallbackTitle(root, c.id, 'fallback');
    _setTitleExecImpl(async () => ({
      stdout:
        '[info] loaded 3 plugins, warming model cache, this line is far longer than sixty chars\nOffer Comparison Summary\n',
    }));
    await generateConversationTitle(baseOpts(c.id));
    expect(getConversation(root, c.id)?.title).toBe('Offer Comparison Summary');
  });

  it('the REAL exec closes child stdin so a stdin-reading CLI does not hang', async () => {
    // Direct regression test for the stdin fix, exercising the real execFile
    // path (not the mock). The fake command reads stdin to EOF then prints a
    // title: with stdin closed (the fix) `cat` gets EOF immediately and the
    // title lands; without it, `cat` blocks until the title timeout and this
    // test fails (fallback stays / vitest timeout).
    const c = createConversation(root);
    applyFallbackTitle(root, c.id, 'fallback');
    _setTitleExecImpl(null); // use the real execFile-based exec
    const fakeProvider = {
      id: 'claude',
      buildHeadlessArgs: () => ({
        cmd: '/bin/bash',
        args: ['-c', 'cat > /dev/null; printf "Stdin Was Closed"'],
      }),
    } as unknown as ReturnType<typeof getProvider>;
    await generateConversationTitle({ ...baseOpts(c.id), provider: fakeProvider });
    expect(getConversation(root, c.id)?.title).toBe('Stdin Was Closed');
  }, 15_000);
});
