// src/lib/server/providers/chat-capabilities.ts
//
// Capability probing for chat-turn session resume (design spec §3.1: parity
// via probing, never provider-name forking). One `--help` run per installed
// binary version tells us whether the CLI can resume a session; the turn
// runner takes the resend path whenever the probe says no. Cached per
// `<provider>@<version>` so a CLI upgrade re-probes automatically. The
// cache lives on globalThis for the same Turbopack/HMR reason as
// chat/db.ts.

import 'server-only';
import { execFileSync } from 'node:child_process';
import type { ProviderId } from '../../schemas/providers';
import type { Provider } from './types';

export type ChatCapabilities = { resume: boolean };

type ExecImpl = (cmd: string, args: string[]) => string;

const defaultExec: ExecImpl = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000, maxBuffer: 4 * 1024 * 1024 });

let execImpl: ExecImpl = defaultExec;

/** Test hook — pass null to restore the real exec. */
export function _setExecImpl(impl: ExecImpl | null): void {
  execImpl = impl ?? defaultExec;
}

const cache: Map<string, ChatCapabilities> = ((
  globalThis as unknown as { __sur9eChatCaps?: Map<string, ChatCapabilities> }
).__sur9eChatCaps ??= new Map());

/** Test hook — clears the per-version probe cache. */
export function _clearCapabilitiesCache(): void {
  cache.clear();
}

// What resume support looks like in each CLI's --help output.
const RESUME_MARKERS: Record<ProviderId, RegExp> = {
  claude: /--resume/,
  codex: /exec resume/,
  opencode: /--session/,
};

export async function probeChatCapabilities(provider: Provider): Promise<ChatCapabilities> {
  const installed = await provider.checkInstalled();
  const key = `${provider.id}@${installed.version ?? 'unknown'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let resume = false;
  if (installed.ok) {
    try {
      const help = execImpl(provider.binary, ['--help']);
      resume = RESUME_MARKERS[provider.id]?.test(help) ?? false;
    } catch {
      // A failed probe degrades to the resend path; it must never block a turn.
      resume = false;
    }
  }
  const caps: ChatCapabilities = { resume };
  cache.set(key, caps);
  return caps;
}
