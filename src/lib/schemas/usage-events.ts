// lib/schemas/usage-events.ts
//
// Zod schema for the [USAGE] marker emitted by stream-claude-parser.mjs
// at the end of a successful claude run. jobs.mjs greps for the last
// [USAGE] line in the spawned job's output and forwards the payload into
// trackClaude(...) so per-mode spend lands in usage.json.
//
// Every field is nullable because the stream parser may emit nulls when
// the upstream `result` event is missing the corresponding usage field.

import { z } from 'zod';

export const UsageEvent = z.object({
  cost_usd: z.number().nullable(),
  input_tokens: z.number().int().nullable(),
  output_tokens: z.number().int().nullable(),
  model: z.string().nullable(),
});
export type UsageEvent = z.infer<typeof UsageEvent>;

const USAGE_PREFIX = '[USAGE] ';

/**
 * Parse a single `[USAGE] {…}` line into a typed UsageEvent. Returns
 * null when the line is not a usage marker or the JSON payload is
 * malformed. Lives next to the schema because the wrapped .mjs
 * (cli/stream-claude-parser.mjs) is a stdin/stdout CLI with no exports
 * of its own — this helper is the typed surface for its output.
 */
export function parseUsageMarker(line: string): UsageEvent | null {
  if (typeof line !== 'string' || !line.startsWith(USAGE_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line.slice(USAGE_PREFIX.length));
  } catch {
    return null;
  }
  const parsed = UsageEvent.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Scan a multi-line output string for the last `[USAGE] {…}` marker.
 * Mirrors the extraction logic in jobs.mjs (line 489-507): walk the
 * output in reverse, return the first parseable usage payload.
 */
export function extractLastUsageMarker(output: string | null | undefined): UsageEvent | null {
  if (!output) return null;
  const lines = output.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = parseUsageMarker(lines[i] ?? '');
    if (candidate) return candidate;
  }
  return null;
}
