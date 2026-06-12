// lib/schemas/portals.ts
//
// zod schema for inputs/personalization/portals.yml — the ATS portal
// scanner's company list, consumed by batch/scan-portals.mjs.
//
// Shape: a single `tracked_companies` array. Title/location filtering is NOT
// here — both scanners share one keyword sieve (profile.yml `search.terms`),
// so portals.yml stays a pure company list.
//
// Lenient on purpose (.passthrough() at both levels): this file is hand-edited
// by users copying the example template, which may carry extra keys (notes,
// or legacy `scan_method` / `scan_query` from older templates). Unknown keys
// shouldn't break the read path that powers the Settings ATS panel.

import { z } from 'zod';

export const TrackedCompany = z
  .object({
    name: z.string(),
    // At least one of careers_url / api is needed for the scanner to derive an
    // endpoint, but both are optional here — the scanner skips undetectable
    // entries rather than the schema rejecting the whole file.
    careers_url: z.string().optional(),
    api: z.string().optional(),
    notes: z.string().optional(),
    // Omitted is treated as enabled by the scanner (only explicit false skips).
    enabled: z.boolean().optional(),
    // Local parser (universal-scanner escape hatch): for a company whose
    // careers page isn't one of the built-in ATS, point at a local script the
    // scanner runs (execFile, no shell) to emit {jobs:[...]}. `command` must be
    // an allowed interpreter and `script` must resolve inside inputs/parsers/ —
    // both enforced in batch/scan-portals.mjs. Scripts are agent/editor-authored.
    parser: z
      .object({
        command: z.string(),
        script: z.string().optional(),
        args: z.array(z.string()).optional(),
        timeout_ms: z.number().optional(),
        max_buffer_bytes: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type TrackedCompany = z.infer<typeof TrackedCompany>;

export const PortalsShape = z
  .object({
    tracked_companies: z.array(TrackedCompany).default([]),
  })
  .passthrough();
export type PortalsShape = z.infer<typeof PortalsShape>;
