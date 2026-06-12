// src/hooks/use-running-mode-poll.ts
//
// Polls the server-side running-mode state (see
// src/server/actions/running-mode.ts → getRunningModeStatus) every 2s
// while `enabled` is true, so the editor's `<runningMode>` placeholder
// node can flip to a "done" or "failed" visual without a full page
// reload. The poll stops on the first terminal state (`done` | `failed`)
// or when the consumer unmounts / flips `enabled` to false — the
// useEffect cleanup always tears down the interval AND a `cancelled`
// flag, so a request in flight when the component unmounts can't push
// state into a torn-down node.

'use client';

import { useEffect, useState } from 'react';
import { getRunningModeStatus, type ModeState } from '@/server/actions/running-mode';

const POLL_MS = 2000;

export function useRunningModePoll(
  num: number,
  mode: string,
  enabled: boolean,
  since?: string,
): ModeState {
  const [state, setState] = useState<ModeState>({ status: 'running' });

  useEffect(() => {
    // When disabled we don't even set up a timer — and we reset back to
    // 'running' so a later flip to enabled=true starts from a clean slate
    // rather than carrying the previous (num, mode) pair's terminal state.
    if (!enabled) {
      setState({ status: 'running' });
      return;
    }

    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const s = await getRunningModeStatus(num, mode, since);
        if (cancelled) return;
        setState(s);
        if (s.status !== 'running') {
          clearInterval(id);
        }
      } catch {
        // Network blip — keep polling. A genuine 'failed' status comes
        // from the server side, not from a transport-level error here.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [num, mode, enabled, since]);

  return state;
}
