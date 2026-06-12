import { z } from 'zod';
import { ReportSummary } from './applications';

export const ScoringEntry = z.object({
  category: z.string(),
  score: z.number(),
  weight: z.number(),
  notes: z.string().optional(),
});
export type ScoringEntry = z.infer<typeof ScoringEntry>;

export const AppendedSection = z.object({
  title: z.string(),
  body: z.string(),
  // Pre-rendered HTML produced by extractAppendedSections (marked.parse).
  // Optional only because some callers may not populate it; without it
  // declared the schema's default .strip() drops the field and the section
  // body renders as a blank "▸ Company research · 6 axes" disclosure.
  rawHtml: z.string().optional(),
});
export type AppendedSection = z.infer<typeof AppendedSection>;

export const ParsedReport = z
  .object({
    header: z.record(z.string(), z.string()).optional(),
    summary: ReportSummary.nullable().optional(),
    sections: z.array(z.object({ title: z.string(), body: z.string() }).passthrough()).optional(),
    appended_sections: z.array(AppendedSection).optional(),
    scoring: z.array(ScoringEntry).optional(),
  })
  .passthrough(); // Runtime emits many additional fields (state, score, archetype, etc.) — keep them flowing.
export type ParsedReport = z.infer<typeof ParsedReport>;

export const ReportData = z.object({
  markdown: z.string(),
  html: z.string(),
  fileName: z.string(),
  parsed: ParsedReport.nullable(),
  error: z.string().optional(),
  path: z.string().nullable().optional(),
});
export type ReportData = z.infer<typeof ReportData>;

export const ReportError = z.object({
  error: z.string(),
  path: z.string().nullable(),
});
export type ReportError = z.infer<typeof ReportError>;

export const ReportFrontmatter = z.object({
  num: z.number().int().positive(),
  company: z.string(),
  role: z.string(),
  date: z.string(),
  // True posting date (YYYY-MM-DD) captured at scan/evaluation time.
  // Optional by contract: absent when the source never reported one (no
  // backfill). `date` above keeps its existing added/scan-date meaning.
  // js-yaml parses an unquoted `posted: 2026-06-01` (hand-edited reports)
  // into a Date object — coerce it back so the report stays loadable.
  posted: z.preprocess(
    v => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
    z.string().optional(),
  ),
  url: z.string().optional(),
  status: z.string(),
  state: z.enum(['screened', 'evaluated']),
  // batch/screen.mjs writes the literal 'N/A' for unreadable/prefiltered
  // postings (never a fabricated 0.0) — accept it so those reports stay loadable.
  score: z.union([z.number().min(0).max(5), z.literal('N/A')]),
  archetype: z.string().default(''),
  archetype_short: z.string().optional(),
  seniority: z.string().optional(),
  seniority_short: z.string().optional(),
  locations: z.union([z.string(), z.array(z.string())]).optional(),
  loc_short: z.string().optional(),
  remote: z.union([z.string(), z.boolean()]).optional(),
  comp: z.string().optional(),
  comp_short: z.string().optional(),
  comp_range: z.string().optional(),
  work_mode: z.string().optional(),
  company_logo: z.string().optional(),
  location: z.string().optional(),
  legitimacy: z.union([z.string(), z.object({ tier: z.string().optional() })]).optional(),
  tldr: z.string().default(''),
  score_breakdown: z
    .object({
      cv_match: z.number(),
      seniority: z.number(),
      compensation: z.number(),
      domain: z.number(),
      geo: z.number(),
      legitimacy: z.number(),
    })
    .partial()
    .optional(),
  snapshot: z
    .object({
      match: z
        .object({
          jd: z.string().optional(),
          cv: z.string().optional(),
          strength: z.string().optional(),
        })
        .optional(),
      watch: z
        .object({
          title: z.string().optional(),
          severity: z.string().optional(),
          mitigation: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  cv_pdf_path: z.string().nullable().optional(),
  cover_letter_path: z.string().nullable().optional(),
  outreach_path: z.string().nullable().optional(),
  has_company_research: z.boolean().optional(),
  has_interview_process: z.boolean().optional(),
});
export type ReportFrontmatter = z.infer<typeof ReportFrontmatter>;
