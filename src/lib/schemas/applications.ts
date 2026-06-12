import { z } from 'zod';

export const APPLICATION_STATUSES = [
  'screened',
  'evaluated',
  'applied',
  'responded',
  'interview',
  'offer',
  'rejected',
  'discarded',
] as const;

export const ApplicationStatus = z.preprocess(
  v => (v === 'skip' ? 'discarded' : v),
  z.enum(APPLICATION_STATUSES),
);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

export const ApplicationRow = z.object({
  num: z.number().int().positive(),
  date: z.string(),
  company: z.string(),
  role: z.string(),
  score: z.string(),
  status: z.string(), // raw status from markdown; canonical form is normalized via normalizeStatus()
  pdf: z.string(),
  reportPath: z.string().nullable(),
  notes: z.string().default(''),
  // True posting date (YYYY-MM-DD) from the optional trailing `Posted`
  // tracker column. Absent on legacy 9-column rows and when the scan source
  // reported none — `date` stays the added/scan date either way.
  posted: z.string().optional(),
});
export type ApplicationRow = z.infer<typeof ApplicationRow>;

// Summary block from a parsed report. The frontmatter loader projects ~14
// fields: compRange, loc, archetype + their _short/_full variants +
// locations/remote/seniority_short. Declared as .passthrough() so consumers
// (hooks/use-applications.ts, lib/analytics/compute.ts, archetype-section.tsx)
// still see the full surface after the typed loaders parse through this schema.
// The three required keys are the only ones every report is guaranteed to have.
export const ReportSummary = z
  .object({
    compRange: z.string().nullable(),
    loc: z.string().nullable(),
    archetype: z.string().nullable(),
    work_mode: z.string().optional(),
    company_logo: z.string().optional(),
    seniority: z.string().optional(),
    location: z.string().optional(),
    url: z.string().nullish(),
    // True posting date (YYYY-MM-DD) projected from report frontmatter
    // `posted`; absent when the source never reported one.
    posted: z.string().optional(),
  })
  .passthrough();
export type ReportSummary = z.infer<typeof ReportSummary>;

export const ApplicationWithSummary = ApplicationRow.extend({
  summary: ReportSummary.nullable(),
});
export type ApplicationWithSummary = z.infer<typeof ApplicationWithSummary>;

export const OutreachPack = z.object({
  frontmatter: z.unknown(), // refined per-section once the outreach schema lands
  body: z.string(),
});
export type OutreachPack = z.infer<typeof OutreachPack>;

export const ApplicationDetail = ApplicationRow.extend({
  report: z.unknown().optional(), // refined in the reports schema
  cv_pdf_path: z.string().nullable(),
  cover_letter_path: z.string().nullable(),
  outreach_path: z.string().nullable(),
  outreach: OutreachPack.nullable(),
  has_company_research: z.boolean(),
  has_interview_process: z.boolean(),
});
export type ApplicationDetail = z.infer<typeof ApplicationDetail>;
