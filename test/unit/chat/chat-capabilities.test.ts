import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _clearCapabilitiesCache,
  _setExecImpl,
  probeChatCapabilities,
} from '@/lib/server/providers/chat-capabilities';
import type { Provider } from '@/lib/server/providers/types';

afterEach(() => {
  _setExecImpl(null);
  _clearCapabilitiesCache();
});

function fakeProvider(id: 'claude' | 'codex' | 'opencode', version = '1.0.0'): Provider {
  return {
    id,
    binary: id,
    checkInstalled: async () => ({ ok: true, version }),
  } as unknown as Provider;
}

describe('probeChatCapabilities', () => {
  it('claude: resume true when --help lists --resume', async () => {
    _setExecImpl(() => 'Usage: claude ...\n  --resume <id>  Resume a session\n');
    expect(await probeChatCapabilities(fakeProvider('claude'))).toEqual({ resume: true });
  });

  it('claude: resume false when the flag is absent', async () => {
    _setExecImpl(() => 'Usage: claude ...\n  --model <id>\n');
    expect(await probeChatCapabilities(fakeProvider('claude'))).toEqual({ resume: false });
  });

  it('codex: keys on the `exec resume` subcommand', async () => {
    _setExecImpl(() => 'Commands:\n  exec resume  Continue a previous exec run\n');
    expect(await probeChatCapabilities(fakeProvider('codex'))).toEqual({ resume: true });
    _clearCapabilitiesCache();
    _setExecImpl(() => 'Commands:\n  exec  Run non-interactively\n');
    expect(await probeChatCapabilities(fakeProvider('codex'))).toEqual({ resume: false });
  });

  it('opencode: keys on a --session flag', async () => {
    _setExecImpl(() => 'Flags:\n  --session <id>  Continue a session\n');
    expect(await probeChatCapabilities(fakeProvider('opencode'))).toEqual({ resume: true });
  });

  it('caches per binary version — --help runs once per version', async () => {
    const exec = vi.fn(() => '--resume');
    _setExecImpl(exec);
    await probeChatCapabilities(fakeProvider('claude', '2.0.0'));
    await probeChatCapabilities(fakeProvider('claude', '2.0.0'));
    expect(exec).toHaveBeenCalledTimes(1);
    await probeChatCapabilities(fakeProvider('claude', '2.1.0')); // upgrade → re-probe
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('binary missing or probe crash → resume false (resend path)', async () => {
    const missing = {
      id: 'claude',
      binary: 'claude',
      checkInstalled: async () => ({ ok: false, error: 'not found' }),
    } as unknown as Provider;
    expect(await probeChatCapabilities(missing)).toEqual({ resume: false });
    _clearCapabilitiesCache();
    _setExecImpl(() => {
      throw new Error('boom');
    });
    expect(await probeChatCapabilities(fakeProvider('claude'))).toEqual({ resume: false });
  });
});
