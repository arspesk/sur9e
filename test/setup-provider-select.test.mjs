// test/setup-provider-select.test.mjs
import { describe, expect, it } from 'vitest';
import { pickModels, selectProvider } from '../scripts/lib/provider-select.mjs';

const claudeModels = [
  { id: 'claude-opus-4-7', label: 'opus' },
  { id: 'claude-sonnet-4-6', label: 'sonnet' },
  { id: 'claude-haiku-4-5-20251001', label: 'haiku' },
];
const opencodeModels = [
  { id: 'anthropic/claude-3-haiku', label: 'h' },
  { id: 'anthropic/claude-3-sonnet', label: 's' },
];

describe('pickModels', () => {
  it('claude → sonnet default, haiku screen', () => {
    expect(pickModels('claude', claudeModels)).toEqual({
      default: 'claude-sonnet-4-6',
      screen: 'claude-haiku-4-5-20251001',
      batchEvaluate: 'claude-sonnet-4-6',
    });
  });
  it('opencode → provider/model ids', () => {
    expect(pickModels('opencode', opencodeModels)).toEqual({
      default: 'anthropic/claude-3-sonnet',
      screen: 'anthropic/claude-3-haiku',
      batchEvaluate: 'anthropic/claude-3-sonnet',
    });
  });
  it('falls back to first model when no preference matches', () => {
    expect(pickModels('claude', [{ id: 'x', label: 'x' }])).toEqual({
      default: 'x',
      screen: 'x',
      batchEvaluate: 'x',
    });
  });
  it('throws on an empty model list (never silently falls back to Claude)', () => {
    expect(() => pickModels('opencode', [])).toThrow(/No models available/);
  });
});

describe('selectProvider', () => {
  const probe = over => ({
    claude: { installed: { ok: true }, authed: { ok: true }, models: claudeModels },
    codex: { installed: { ok: false }, authed: { ok: false }, models: [] },
    opencode: { installed: { ok: true }, authed: { ok: false }, models: opencodeModels },
    ...over,
  });

  it('preselects the ready CLI and labels each provider by status', () => {
    // claude authed + opencode installed-but-unauthed + codex absent.
    const r = selectProvider(probe());
    expect(r.installed).toEqual(['claude', 'opencode']);
    expect(r.ready).toEqual(['claude']);
    expect(r.preselect).toBe('claude');
    expect(r.options.find(o => o.id === 'claude').label).toMatch(/ready/);
    expect(r.options.find(o => o.id === 'opencode').label).toMatch(/needs auth/);
    expect(r.options.find(o => o.id === 'codex').label).toMatch(/not installed/);
  });

  it('preselects an installed-but-unauthed CLI when none are authed', () => {
    const r = selectProvider(
      probe({ claude: { installed: { ok: true }, authed: { ok: false }, models: claudeModels } }),
    );
    expect(r.ready).toEqual([]);
    expect(r.preselect).toBe('claude'); // first installed
  });

  it('falls back to claude preselect when nothing installed', () => {
    const r = selectProvider({
      claude: { installed: { ok: false }, authed: { ok: false }, models: claudeModels },
      codex: { installed: { ok: false }, authed: { ok: false }, models: [] },
      opencode: { installed: { ok: false }, authed: { ok: false }, models: opencodeModels },
    });
    expect(r.preselect).toBe('claude');
  });
});
