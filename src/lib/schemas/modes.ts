// lib/schemas/modes.ts
//
// zod schema for the YAML front-matter that prefixes every file in
// content/modes/*.md. Declares which exec surface a mode supports
// (headless / interactive / both), its default platform + model, and
// the tools it needs (`shell`, `file_read`, ...). The mode loader
// parses the front-matter once at startup and uses this schema as the
// validation boundary — downstream code can trust the shape and never
// re-validates.
//
// Defaults: every field has a default so an existing mode file with no
// front-matter parses as `{ exec: 'interactive', default_platform:
// 'claude', default_model: 'claude-sonnet-4-6', needs_tools: [] }`.
// That keeps the loader backward-compatible while per-mode front-matter
// rolls out across the catalogue.

import { z } from 'zod';
import { ProviderId } from './providers';

export const ModeExec = z.enum(['headless', 'interactive', 'both']);

export const ModeTool = z.enum([
  'shell',
  'file_read',
  'file_write',
  'web_fetch',
  'web_search',
  'browser',
]);

export const ModeFrontMatter = z
  .object({
    exec: ModeExec.default('interactive'),
    default_platform: ProviderId.default('claude'),
    default_model: z.string().min(1).default('claude-sonnet-4-6'),
    needs_tools: z.array(ModeTool).default([]),
  })
  .strict();

export type ModeFrontMatter = z.infer<typeof ModeFrontMatter>;
export const ModeFrontMatterDefaults: ModeFrontMatter = ModeFrontMatter.parse({});

export type ModeMeta = ModeFrontMatter & {
  modeId: string; // filename without `.md`
  body: string; // mode body sans front-matter
};

// ── /api/modes response contract ─────────────────────────────────────────────
// Shared by the route handler (src/app/api/modes/route.ts) and the
// useModeManifest hook. Strips `body` (multi-KB per mode) from ModeMeta.

export type ModeMetaResponse = Pick<
  ModeMeta,
  'modeId' | 'exec' | 'default_platform' | 'default_model' | 'needs_tools'
>;

export interface ModesResponse {
  modes: ModeMetaResponse[];
}
