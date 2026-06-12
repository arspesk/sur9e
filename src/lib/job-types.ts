/* lib/job-types.ts
 *
 * Single source of truth for background job-type metadata. Both the
 * cross-page loading modal and the Offers Add menu read from JOB_TYPES so
 * labels, toast messages, and "in flight" copy don't drift apart.
 *
 * Verbatim port of legacy public/job-types.js — field names, ordering, and
 * copy preserved 1:1. Adding a new bulk action only takes a registry entry
 * + an /api/jobs/<type> endpoint; no markup or handler changes needed.
 *
 * Each entry:
 *   type            — backend job type, matches POST /api/jobs/{type}
 *   menuTitle       — Add-menu title (Offers tab dropdown)
 *   menuTitleBusy   — Add-menu title while the job is in flight
 *   menuSub         — Add-menu sub-line description
 *   pillTitle       — Title shown in the cross-page status pill
 *   refreshOnDone   — Pull fresh data on done
 *
 * Priority order = display order in the menu and the reattach order in the
 * status pill. Per-offer evaluate wins over bulk over single-URL.
 */

export interface JobType {
  type: string;
  menuTitle: string | null;
  menuTitleBusy: string | null;
  menuSub: string | null;
  menuIcon: string | null;
  pillTitle: string;
  pillTitleNum?: string;
  failMsg: string;
  refreshOnDone: boolean;
  /** Rough expected duration in seconds — drives the card's top progress
   * bar (elapsed/estimateS, capped at 96% until the job lands). */
  estimateS: number;
}

export const JOB_TYPES: JobType[] = [
  {
    type: 'evaluate',
    menuTitle: null, // not in the Add menu — triggered from per-row actions
    menuTitleBusy: null,
    menuSub: null,
    menuIcon: null,
    pillTitle: 'Evaluating…',
    // Per-num title used when params.num is present — keeps the cross-page
    // reattach pill in sync with what run-evaluate shows on the page that
    // started the job. {num} is substituted by the num from params.
    pillTitleNum: 'Evaluating #{num}…',
    failMsg: 'Evaluation failed — open the offer to retry',
    refreshOnDone: true,
    estimateS: 600,
  },
  {
    type: 'tailor-cv',
    menuTitle: null,
    menuTitleBusy: null,
    menuSub: null,
    menuIcon: null,
    pillTitle: 'Tailoring CV…',
    pillTitleNum: 'Tailoring CV for #{num}…',
    failMsg: 'CV generation failed — retry from the offer',
    refreshOnDone: true,
    estimateS: 240,
  },
  {
    type: 'cover-letter',
    menuTitle: null,
    menuTitleBusy: null,
    menuSub: null,
    menuIcon: null,
    pillTitle: 'Generating cover letter…',
    pillTitleNum: 'Generating cover letter for #{num}…',
    failMsg: 'Cover-letter generation failed — retry from the offer',
    refreshOnDone: true,
    estimateS: 180,
  },
  {
    type: 'research',
    menuTitle: null,
    menuTitleBusy: null,
    menuSub: null,
    menuIcon: null,
    pillTitle: 'Researching company…',
    pillTitleNum: 'Researching #{num}…',
    failMsg: 'Company research failed — retry from the offer',
    refreshOnDone: true,
    estimateS: 420,
  },
  {
    type: 'interview-prep',
    menuTitle: null,
    menuTitleBusy: null,
    menuSub: null,
    menuIcon: null,
    pillTitle: 'Generating interview prep…',
    pillTitleNum: 'Generating interview prep for #{num}…',
    failMsg: 'Interview prep generation failed — retry from the offer',
    refreshOnDone: true,
    estimateS: 420,
  },
  {
    type: 'reach-out',
    menuTitle: null,
    menuTitleBusy: null,
    menuSub: null,
    menuIcon: null,
    pillTitle: 'Drafting outreach…',
    pillTitleNum: 'Drafting outreach for #{num}…',
    failMsg: 'Outreach generation failed — retry from the offer',
    refreshOnDone: true,
    estimateS: 600,
  },
  {
    type: 'negotiate',
    menuTitle: null,
    menuTitleBusy: null,
    menuSub: null,
    menuIcon: null,
    pillTitle: 'Building negotiation strategy…',
    pillTitleNum: 'Building negotiation strategy for #{num}…',
    failMsg: 'Negotiation strategy failed — retry from the offer',
    refreshOnDone: true,
    estimateS: 300,
  },
  {
    type: 'scan',
    menuTitle: 'Scan with screening',
    menuTitleBusy: 'Scanning…',
    menuSub: 'Scan for offers with basic screening',
    menuIcon: '⌕',
    pillTitle: 'Scanning portals…',
    failMsg: 'Scan failed — check Settings → Job scanning and retry',
    refreshOnDone: true,
    estimateS: 600,
  },
  {
    type: 'batch-evaluate',
    menuTitle: 'Scan with evaluation',
    menuTitleBusy: 'Batch evaluating…',
    menuSub: 'Scan for offers with full evaluation',
    menuIcon: '⇪',
    pillTitle: 'Batch evaluating offers…',
    failMsg: 'Batch evaluation failed — see logs',
    refreshOnDone: true,
    estimateS: 1800,
  },
  {
    type: 'screen',
    menuTitle: 'Add offer',
    menuTitleBusy: 'Adding…',
    menuSub: 'Paste a job posting link',
    menuIcon: '+',
    pillTitle: 'Screening…',
    failMsg: "Couldn't read that posting — paste the link again or check it",
    refreshOnDone: true,
    estimateS: 90,
  },
  {
    type: 'screen-evaluate',
    menuTitle: null, // not a menu item — the second depth option inside the Add-offer modal
    menuTitleBusy: null,
    menuSub: null,
    menuIcon: null,
    pillTitle: 'Adding & evaluating offer…',
    failMsg: "Couldn't add & evaluate the offer — try again from Add offer",
    refreshOnDone: true,
    estimateS: 720,
  },
];

export const JOB_TYPES_BY_TYPE: Readonly<Record<string, JobType>> = Object.freeze(
  Object.fromEntries(JOB_TYPES.map(j => [j.type, j])),
);

/**
 * Rough duration band ("~7–15 min") around an estimate in seconds — ≈0.7×–1.5×
 * of the figure, rounded to whole minutes (min 1). The single estimateS still
 * paces the progress card; the band just brackets it so the modal sets an
 * honest expectation without promising a precise time. Collapses to "~N min"
 * when the rounded ends meet.
 */
export function formatEstimate(seconds: number): string {
  const lo = Math.max(1, Math.round((seconds * 0.7) / 60));
  const hi = Math.max(lo, Math.round((seconds * 1.5) / 60));
  return lo === hi ? `~${lo} min` : `~${lo}–${hi} min`;
}

/**
 * The confirm-modal "Time:" band for a job type, derived from the same
 * estimateS that paces the progress card — single source of truth, so the
 * modal's promise can't contradict the bar the user watches next.
 */
export function jobEstimateLabel(type: string): string {
  return formatEstimate(JOB_TYPES_BY_TYPE[type]?.estimateS ?? 300);
}
