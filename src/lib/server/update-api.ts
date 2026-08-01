import 'server-only';
import { z } from 'zod';
import { getWebLaunchMode } from '../../../scripts/web.mjs';

const UpdateApplyBody = z
  .object({
    toVersion: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type UpdateApplyBody = z.infer<typeof UpdateApplyBody>;

export async function parseUpdateApplyBody(request: Request): Promise<UpdateApplyBody | null> {
  const text = await request.text();
  if (text.trim() === '') return {};
  try {
    const parsed = UpdateApplyBody.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface UpdateLaunchMode {
  prod: boolean;
  tailscale: boolean;
}

const UpdateLaunchMode = z.object({ prod: z.boolean(), tailscale: z.boolean() }).strict();

function fallbackLaunchMode(request: Request): UpdateLaunchMode {
  let origin: URL;
  try {
    origin = new URL(request.headers.get('origin') ?? request.url);
  } catch {
    origin = new URL(request.url);
  }
  const hostname = origin.hostname.toLowerCase();
  const localhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  return {
    prod: process.env.NODE_ENV === 'production',
    tailscale: !localhost && origin.protocol === 'https:' && hostname.endsWith('.ts.net'),
  };
}

/** Prefer the managed launcher's persisted mode; use only conservative request
 * and runtime signals if that metadata cannot be read or validated. */
export function resolveUpdateLaunchMode(request: Request): UpdateLaunchMode {
  const fallback = fallbackLaunchMode(request);
  try {
    const persisted = UpdateLaunchMode.safeParse(getWebLaunchMode());
    if (persisted.success) {
      // getWebLaunchMode deliberately represents absent/stale metadata as the
      // safest local-dev mode. Strong runtime/request evidence may only turn
      // those false flags on; it can never erase a persisted true flag.
      return {
        prod: persisted.data.prod || fallback.prod,
        tailscale: persisted.data.tailscale || fallback.tailscale,
      };
    }
  } catch {
    // A missing/stale launcher record must not prevent a safe restart attempt.
  }
  return fallback;
}
