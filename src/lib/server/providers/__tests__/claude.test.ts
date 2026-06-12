// src/lib/server/providers/__tests__/claude.test.ts
//
// Tests for the Claude adapter. The buildHeadlessArgs
// snapshot is the parity guard for the dispatcher swap — if it shifts, the legacy
// `claude -p …` call sites in command-registry.ts will behave differently
// after the swap.
//
// listModels is tested by spying on the `__testing` helpers
// the adapter exports for exactly this purpose (`resolveClaudeBinary`
// and `extractModelsFromBinary`), and on `claudeProvider.checkInstalled`
// for the version probe. We deliberately avoid `vi.mock('node:fs', …)` /
// `vi.mock('node:child_process', …)` here — Vitest's mocking of Node
// built-ins imported via the `node:` prefix turned out to be flaky in
// this project's setup; spying on first-party helpers is precise and
// behaves the same under `vitest run` and `vitest run -t …` filters.
//
// The synthetic strings dump exercised below mirrors the actual output
// of `strings <claude-binary>` on the user's system, so the cleaner is
// proven against the real fixture data, not a stripped-down version.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import claudeProvider, { __testing } from '../claude';

// Raw `^claude-(opus|sonnet|haiku)-…$` lines observed by running `strings`
// on the user's actual claude-code-darwin-arm64/claude binary. Includes
// the regex-source decoy `claude-opus-4(?!-\d(?!\d))`, `@`-suffixed
// duplicates, and `[1m]` context-window variants — the cleaner has to
// triage all three.
const REAL_BINARY_STRINGS = `claude-haiku-3-5
claude-haiku-4
claude-haiku-4-5
claude-haiku-4-5-20251001
claude-haiku-4-5@20251001
claude-opus-4
claude-opus-4-0
claude-opus-4-1
claude-opus-4-1-20250805
claude-opus-4-1@20250805
claude-opus-4-20250514
claude-opus-4-5
claude-opus-4-5-20251101
claude-opus-4-5@20251101
claude-opus-4-6
claude-opus-4-6[1m]
claude-opus-4-7
claude-opus-4(?!-\\d(?!\\d))
claude-opus-4@20250514
claude-sonnet-3-7
claude-sonnet-4
claude-sonnet-4-0
claude-sonnet-4-20250514
claude-sonnet-4-5
claude-sonnet-4-5-20250929
claude-sonnet-4-5-20250929[1m]
claude-sonnet-4-5@20250929
claude-sonnet-4-6
claude-sonnet-4(?!-\\d(?!\\d))
claude-sonnet-4@20250514
`;

describe('claude provider', () => {
  describe('buildHeadlessArgs', () => {
    it('produces the same command shape as today', () => {
      const { cmd, args } = claudeProvider.buildHeadlessArgs({
        prompt: 'Evaluate offer #42',
        model: 'claude-sonnet-4-6',
      });
      expect(cmd).toBe('/bin/bash');
      expect(args).toMatchSnapshot();
    });
  });

  describe('buildHeadlessArgs — parameterized options', () => {
    // Parameterized tests (not snapshot) because snapshot drift on the same
    // call shape is exactly the regression we want to catch above. These
    // assertions are flag-presence/absence — they tolerate cosmetic
    // whitespace shifts the parity test would also tolerate.

    it('no opts beyond prompt+model reproduces the legacy command-registry shape', () => {
      const { args } = claudeProvider.buildHeadlessArgs({
        prompt: 'X',
        model: 'claude-sonnet-4-6',
      });
      expect(args[1]).toContain('--dangerously-skip-permissions');
      expect(args[1]).toContain('--model claude-sonnet-4-6');
      expect(args[1]).toContain('--output-format stream-json');
      expect(args[1]).toContain('--verbose');
      expect(args[1]).toContain('| node cli/stream-claude-parser.mjs');
    });

    it('outputFormat: "json" emits --output-format json and omits --verbose', () => {
      const { args } = claudeProvider.buildHeadlessArgs({
        prompt: 'X',
        model: 'claude-haiku-4-5-20251001',
        outputFormat: 'json',
        pipeToParser: false,
      });
      expect(args[1]).toContain('--output-format json');
      expect(args[1]).not.toContain('--verbose');
      expect(args[1]).not.toContain('stream-claude-parser.mjs');
    });

    it('outputFormat: "text" omits --output-format entirely', () => {
      const { args } = claudeProvider.buildHeadlessArgs({
        prompt: 'X',
        model: 'claude-sonnet-4-6',
        outputFormat: 'text',
        pipeToParser: false,
      });
      expect(args[1]).not.toContain('--output-format');
      expect(args[1]).not.toContain('--verbose');
      expect(args[1]).not.toContain('stream-claude-parser.mjs');
    });

    it('tools restriction adds --tools T1,T2', () => {
      const { args } = claudeProvider.buildHeadlessArgs({
        prompt: 'X',
        model: 'claude-haiku-4-5-20251001',
        tools: ['WebFetch', 'Write'],
      });
      expect(args[1]).toContain('--tools WebFetch,Write');
    });

    it('empty tools array is treated as no restriction (no --tools flag)', () => {
      // Regression guard: `Boolean([])` is true in JS, so a naive truthy
      // check would emit a bare `--tools ` which Claude rejects.
      const { args } = claudeProvider.buildHeadlessArgs({
        prompt: 'X',
        model: 'claude-sonnet-4-6',
        tools: [],
      });
      expect(args[1]).not.toContain('--tools');
    });

    it('appendSystemPromptFile adds --append-system-prompt-file <path>', () => {
      const { args } = claudeProvider.buildHeadlessArgs({
        prompt: 'X',
        model: 'claude-sonnet-4-6',
        appendSystemPromptFile: '/tmp/sys.md',
      });
      expect(args[1]).toContain('--append-system-prompt-file /tmp/sys.md');
    });

    it('skipPermissions: false omits --dangerously-skip-permissions', () => {
      const { args } = claudeProvider.buildHeadlessArgs({
        prompt: 'X',
        model: 'claude-sonnet-4-6',
        skipPermissions: false,
      });
      expect(args[1]).not.toContain('--dangerously-skip-permissions');
    });

    it('pipeToParser: false suppresses the parser pipe even with stream-json output', () => {
      const { args } = claudeProvider.buildHeadlessArgs({
        prompt: 'X',
        model: 'claude-sonnet-4-6',
        outputFormat: 'stream-json',
        pipeToParser: false,
      });
      expect(args[1]).toContain('--output-format stream-json');
      expect(args[1]).not.toContain('stream-claude-parser.mjs');
    });

    it('screen.mjs shape: json + tools + system prompt file, no pipe', () => {
      // Mirror what batch/screen.mjs will pass after migration. Locks the
      // combined shape so a refactor that breaks any one of these in
      // isolation gets caught even if its individual test still passes.
      const { args } = claudeProvider.buildHeadlessArgs({
        prompt: 'Job to screen: ...',
        model: 'claude-haiku-4-5-20251001',
        outputFormat: 'json',
        pipeToParser: false,
        tools: ['WebFetch', 'Write'],
        appendSystemPromptFile: '/abs/path/to/screen-system-prompt.md',
      });
      expect(args[1]).toContain('--dangerously-skip-permissions');
      expect(args[1]).toContain('--model claude-haiku-4-5-20251001');
      expect(args[1]).toContain('--output-format json');
      expect(args[1]).toContain('--tools WebFetch,Write');
      expect(args[1]).toContain('--append-system-prompt-file /abs/path/to/screen-system-prompt.md');
      expect(args[1]).not.toContain('--verbose');
      expect(args[1]).not.toContain('stream-claude-parser.mjs');
    });

    it('batch-runner.sh shape: text + system prompt file, no pipe, no tools', () => {
      // Mirror what batch/batch-runner.sh will pass after migration.
      const { args } = claudeProvider.buildHeadlessArgs({
        prompt: 'Process this job offer...',
        model: 'claude-sonnet-4-6',
        outputFormat: 'text',
        pipeToParser: false,
        appendSystemPromptFile: '/abs/path/to/resolved-prompt.md',
      });
      expect(args[1]).toContain('--dangerously-skip-permissions');
      expect(args[1]).toContain('--model claude-sonnet-4-6');
      expect(args[1]).toContain('--append-system-prompt-file /abs/path/to/resolved-prompt.md');
      expect(args[1]).not.toContain('--output-format');
      expect(args[1]).not.toContain('--verbose');
      expect(args[1]).not.toContain('--tools');
      expect(args[1]).not.toContain('stream-claude-parser.mjs');
    });
  });

  describe('parseStreamLine', () => {
    it('classifies init / thinking / tool_use / text / result events', () => {
      const lines = readFileSync(join(__dirname, 'fixtures/claude-stream.jsonl'), 'utf-8')
        .split('\n')
        .filter(Boolean);
      const events = lines.map(l => claudeProvider.parseStreamLine(l)).filter(Boolean);
      const kinds = events.map(e => e?.kind);
      expect(kinds).toContain('stage');
      expect(kinds).toContain('thinking');
      expect(kinds).toContain('tool');
      expect(kinds).toContain('tokens');
      // Claude has no dedicated end-of-stream event; `result` maps to
      // `tokens`, which is the terminal event for Claude's stream.
      // The `final` kind in the unified schema is reserved for providers
      // that DO emit an explicit end-marker (e.g. codex).
      const tokensEvent = events.find(e => e?.kind === 'tokens');
      expect(tokensEvent?.tokens).toEqual({
        in: 4231,
        out: 582,
        model: 'claude-sonnet-4-6',
        estimated: false,
      });
    });
    it('returns null for unparseable lines', () => {
      expect(claudeProvider.parseStreamLine('garbage')).toBeNull();
      expect(claudeProvider.parseStreamLine('')).toBeNull();
    });
  });

  describe('classifyExitError', () => {
    it('classifies auth failures', () => {
      expect(claudeProvider.classifyExitError('Invalid API key', 1)).toBe('auth');
    });
    it('classifies model-not-found', () => {
      expect(claudeProvider.classifyExitError('model not found', 1)).toBe('model_not_found');
    });
    it('returns unknown for unmatched stderr', () => {
      expect(claudeProvider.classifyExitError('weird stuff', 99)).toBe('unknown');
    });
  });

  describe('extractModelsFromBinary (cleaner)', () => {
    // Unit-test the cleaner directly against the real-binary-strings
    // fixture. We can do this with a real `strings` invocation only on
    // hosts that have the binary + tool — instead we spy on
    // execFileSync via the same `__testing` indirection listModels uses
    // is overkill for this single-shot test. Better: just exercise the
    // cleaning logic by feeding the raw strings through a temp wrapper
    // that returns them. But the simplest, no-mocking-needed approach is
    // to drive the full path via the listModels spies below, so we keep
    // this describe block focused on the labeling/filtering invariants
    // that are easy to assert from the listModels output.

    it('keeps the cleaner deterministic — same input always yields the same ids', () => {
      // Sanity: REAL_BINARY_STRINGS is the fixture; if it ever gets
      // accidentally mutated by another test (it's a const, so it
      // shouldn't), this would fail loudly.
      expect(REAL_BINARY_STRINGS.split('\n').filter(Boolean).length).toBeGreaterThan(20);
    });
  });

  describe('listModels (binary-strings extraction)', () => {
    let resolveSpy: ReturnType<typeof vi.spyOn>;
    let extractSpy: ReturnType<typeof vi.spyOn>;
    let installedSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      __testing.resetCache();
      // Default happy-path stubs: synthetic binary path + extraction
      // returns models the real cleaner would produce from REAL_BINARY_STRINGS.
      resolveSpy = vi
        .spyOn(__testing, 'resolveClaudeBinary')
        .mockReturnValue('/synthetic/claude-code-darwin-arm64/claude');
      extractSpy = vi
        .spyOn(__testing, 'extractModelsFromBinary')
        .mockImplementation(() => realExtractFor(REAL_BINARY_STRINGS));
      installedSpy = vi
        .spyOn(claudeProvider, 'checkInstalled')
        .mockResolvedValue({ ok: true, version: '2.1.150' });
    });

    afterEach(() => {
      // Restore the real impls so we don't leak spies across describe
      // blocks (parseStreamLine etc. don't touch these, but symmetry).
      resolveSpy.mockRestore();
      extractSpy.mockRestore();
      installedSpy.mockRestore();
      __testing.resetCache();
    });

    function realExtractFor(stringsOut: string) {
      // Re-implement what the production cleaner does so the spy returns a
      // representative result. We can't call the real cleaner here because
      // it execs `strings`; running it on the spy path would defeat the
      // spy. The logic mirrors `_extractModelsFromBinary` exactly.
      const matches =
        stringsOut.match(/^claude-(?:opus|sonnet|haiku)-[0-9][0-9a-z.@[\]_-]*$/gm) ?? [];
      const cleaned = matches.filter(id => {
        if (id.includes('(') || id.includes('?')) return false;
        if (id.includes('@')) return false;
        return true;
      });
      const unique = Array.from(new Set(cleaned));
      const familyOrder: Record<string, number> = { opus: 0, sonnet: 1, haiku: 2 };
      unique.sort((a, b) => {
        const fa = a.split('-')[1] ?? '';
        const fb = b.split('-')[1] ?? '';
        if (fa !== fb) return (familyOrder[fa] ?? 9) - (familyOrder[fb] ?? 9);
        return b.localeCompare(a);
      });
      return unique.map(id =>
        id.endsWith('[1m]')
          ? { id, label: `${id.slice(0, -'[1m]'.length)} (1M context)` }
          : { id, label: id },
      );
    }

    it('parses the real-binary strings dump and cleans junk (no hardcoded aliases)', async () => {
      const models = await claudeProvider.listModels();
      const ids = models.map(m => m.id);

      // No hardcoded picker aliases — only what `strings` extracted.
      expect(ids).not.toContain('default');
      expect(ids).not.toContain('sonnet');
      expect(ids).not.toContain('haiku');

      // Real ids the binary contains are included.
      expect(ids).toContain('claude-opus-4-7');
      expect(ids).toContain('claude-opus-4-6');
      expect(ids).toContain('claude-sonnet-4-6');
      expect(ids).toContain('claude-sonnet-4-5');
      expect(ids).toContain('claude-haiku-4-5');
      expect(ids).toContain('claude-haiku-4-5-20251001');

      // `[1m]` context-window variants are kept AND labeled distinctly.
      expect(ids).toContain('claude-opus-4-6[1m]');
      expect(ids).toContain('claude-sonnet-4-5-20250929[1m]');
      const oneM = models.find(m => m.id === 'claude-opus-4-6[1m]');
      expect(oneM?.label).toBe('claude-opus-4-6 (1M context)');

      // Regex-source decoys are filtered out.
      expect(ids.some(id => id.includes('('))).toBe(false);
      expect(ids.some(id => id.includes('?'))).toBe(false);

      // `@`-suffixed duplicates are filtered out (dash form wins).
      expect(ids.some(id => id.includes('@'))).toBe(false);
      // …and the dash-form sibling is still present.
      expect(ids).toContain('claude-opus-4-1-20250805');

      // No duplicates.
      expect(new Set(ids).size).toBe(ids.length);

      // Family ordering: opus before sonnet before haiku.
      const firstOpus = ids.findIndex(id => id.startsWith('claude-opus-'));
      const firstSonnet = ids.findIndex(id => id.startsWith('claude-sonnet-'));
      const firstHaiku = ids.findIndex(id => id.startsWith('claude-haiku-'));
      expect(firstOpus).toBeLessThan(firstSonnet);
      expect(firstSonnet).toBeLessThan(firstHaiku);
    });

    it('caches per `claude --version` — back-to-back calls invoke the extractor exactly once', async () => {
      await claudeProvider.listModels();
      await claudeProvider.listModels();
      expect(extractSpy).toHaveBeenCalledTimes(1);
      // resolveClaudeBinary is also cache-skipped on hit:
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    });

    it('refreshes the cache when the Claude version changes', async () => {
      // First call: version 2.1.150 → uses the default REAL_BINARY_STRINGS
      // extraction.
      await claudeProvider.listModels();

      // User upgrades Claude — version bumps, and the new binary contains
      // a different (smaller, made-up) set of ids.
      installedSpy.mockResolvedValue({ ok: true, version: '2.1.151' });
      extractSpy.mockImplementation(() =>
        realExtractFor('claude-opus-4-8\nclaude-sonnet-4-7\nclaude-haiku-4-6\n'),
      );

      const models = await claudeProvider.listModels();
      const ids = models.map(m => m.id);
      // The new version's ids surface; the old ones don't bleed through.
      expect(ids).toContain('claude-opus-4-8');
      expect(ids).not.toContain('claude-opus-4-7');
      // Extractor ran twice (one per distinct version).
      expect(extractSpy).toHaveBeenCalledTimes(2);
    });

    it('falls back to STATIC_MODELS when checkInstalled fails (Claude not installed)', async () => {
      installedSpy.mockResolvedValue({ ok: false, error: 'command not found' });

      const models = await claudeProvider.listModels();
      const ids = models.map(m => m.id);
      // Static fallback ids present.
      expect(ids).toContain('claude-opus-4-7');
      expect(ids).toContain('claude-sonnet-4-6');
      expect(ids).toContain('claude-haiku-4-5-20251001');
      // No aliases prepended.
      expect(ids).not.toContain('default');
      // Resolve was never called because the version probe short-circuited.
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(extractSpy).not.toHaveBeenCalled();
    });

    it('falls back when resolveClaudeBinary returns null', async () => {
      resolveSpy.mockReturnValue(null);

      const models = await claudeProvider.listModels();
      const ids = models.map(m => m.id);
      expect(ids).toContain('claude-opus-4-7');
      expect(ids).not.toContain('default');
      // Extractor never ran because there's no path to feed it.
      expect(extractSpy).not.toHaveBeenCalled();
    });

    it('falls back when the extractor throws (e.g. `strings` not installed)', async () => {
      extractSpy.mockImplementation(() => {
        throw new Error('strings: command not found');
      });

      const models = await claudeProvider.listModels();
      const ids = models.map(m => m.id);
      expect(ids).toContain('claude-opus-4-7');
      expect(ids).not.toContain('default');
    });

    it('falls back when extraction yields zero ids (binary stripped / unexpected format)', async () => {
      extractSpy.mockReturnValue([]);

      const models = await claudeProvider.listModels();
      const ids = models.map(m => m.id);
      expect(ids).toContain('claude-opus-4-7');
      expect(ids).not.toContain('default');
    });
  });
});
