/* features/report/report-toolbar-config.ts — verbatim port of
 * public/report-toolbar-config.js. The action-bar renderer in
 * report-render.ts reads STATUS_ACTIONS + MODE_REGISTRY + OPEN_POSTING_META
 * from this module (no longer via window globals).
 */

import type { ModalName } from '@/stores/modal-store';
import type { ReportR } from './report-types';

// SVG icons — kept small. Each is a 24×24 viewBox; the .btn rule downsizes to 13×13.
const ICON = {
  openPosting:
    '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  research:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  reachOut:
    '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  tailorCv:
    '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  interviewPrep:
    '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  followUp:
    '<svg viewBox="0 0 24 24"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>',
  apply:
    '<svg viewBox="0 0 24 24"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></svg>',
  evaluate:
    '<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  negotiate:
    '<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  coverLetter:
    '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>',
  documents:
    '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>',
};

export interface ModeMeta {
  label: string;
  lockedLabel?: string;
  downloadField?: keyof ReportR;
  icon: string;
  cliMode: string | null;
  singleUse: boolean;
  isLocked?: (r: ReportR) => boolean;
  hideWhenLocked?: boolean;
}

export const MODE_REGISTRY: Record<string, ModeMeta> = {
  evaluate: {
    label: 'Evaluate',
    icon: ICON.evaluate,
    cliMode: 'evaluate',
    singleUse: true,
    isLocked: r => r.state === 'evaluated',
  },
  apply: {
    label: 'Apply',
    icon: ICON.apply,
    cliMode: 'apply',
    singleUse: true,
    isLocked: r => ['applied', 'responded', 'interview', 'offer', 'rejected'].includes(r.status),
  },
  'tailor-cv': {
    label: 'Tailor CV',
    lockedLabel: 'Download CV',
    downloadField: 'cv_pdf_path',
    icon: ICON.tailorCv,
    cliMode: 'tailor-cv',
    singleUse: true,
    isLocked: r => Boolean(r.cv_pdf_path),
  },
  research: {
    label: 'Company research',
    icon: ICON.research,
    cliMode: 'research',
    singleUse: true,
    isLocked: r => Boolean(r.has_company_research),
  },
  'reach-out': {
    label: 'Reach out',
    icon: ICON.reachOut,
    cliMode: 'reach-out',
    singleUse: true,
    isLocked: r => Boolean(r.outreach_path),
  },
  'interview-prep': {
    label: 'Interview prep',
    icon: ICON.interviewPrep,
    cliMode: 'interview-prep',
    singleUse: true,
    isLocked: r => Boolean(r.has_interview_process),
  },
  'follow-up': {
    label: 'Follow up',
    icon: ICON.followUp,
    cliMode: 'follow-up',
    singleUse: false,
  },
  negotiate: {
    label: 'Negotiate',
    icon: ICON.negotiate,
    cliMode: 'negotiate',
    singleUse: true,
    isLocked: r => Boolean(r.negotiation_doc_path),
  },
  'cover-letter': {
    label: 'Cover letter',
    lockedLabel: 'Download cover letter',
    downloadField: 'cover_letter_path',
    icon: ICON.coverLetter,
    cliMode: 'cover-letter',
    singleUse: true,
    isLocked: r => Boolean(r.cover_letter_path),
  },
  documents: {
    label: 'Documents',
    icon: ICON.documents,
    cliMode: null,
    singleUse: false,
  },
};

export interface StatusActionCfg {
  inline: string[];
  primary: string | null;
}

export const STATUS_ACTIONS: Record<string, StatusActionCfg> = {
  screened: {
    inline: [],
    primary: 'evaluate',
  },
  evaluated: {
    inline: ['research', 'reach-out', 'documents'],
    primary: 'apply',
  },
  applied: {
    inline: ['research', 'documents'],
    primary: 'reach-out',
  },
  responded: {
    inline: ['research', 'documents'],
    primary: 'follow-up',
  },
  interview: {
    inline: ['research', 'documents'],
    primary: 'interview-prep',
  },
  offer: {
    inline: ['documents'],
    primary: 'negotiate',
  },
  rejected: {
    inline: [],
    primary: null,
  },
  discarded: {
    inline: [],
    primary: null,
  },
};

export const OPEN_POSTING_META = {
  label: 'Open posting',
  icon: ICON.openPosting,
};

// The 7 generator modes, in menu order. Shared by the editor slash menu
// (mode-slash-items.ts), the row/card kebab (row-actions-menu.tsx), and the
// bulk Generate menu (batch-action-bar.tsx).
export const GENERATOR_MODES = [
  'evaluate',
  'tailor-cv',
  'cover-letter',
  'research',
  'reach-out',
  'interview-prep',
  'negotiate',
] as const;

export type GeneratorMode = (typeof GENERATOR_MODES)[number];

/** Map generator mode → modal-store key (must match ModalName). */
export const MODE_MODAL_KEY: Record<GeneratorMode, Exclude<ModalName, null>> = {
  evaluate: 'evaluate',
  'tailor-cv': 'cv',
  'cover-letter': 'cover-letter',
  research: 'research',
  'reach-out': 'outreach',
  'interview-prep': 'interview-process',
  negotiate: 'negotiate',
};
