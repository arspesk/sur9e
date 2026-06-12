// lib/portals-detect.ts — pure ATS-provider logic shared by client + server.
//
// The Settings → ATS portals section (client) needs provider detection and
// URL→company derivation for its smart-add composer; the Node-only server
// lib (src/lib/server/portals.ts) re-exports everything here so existing
// server-side imports keep working. No Node APIs, no 'server-only'.
//
// Provider detection mirrors batch/scan-portals.mjs detectApi().

import type { TrackedCompany } from './schemas/portals';

export type AtsProvider =
  | 'greenhouse'
  | 'ashby'
  | 'lever'
  | 'workable'
  | 'workday'
  | 'recruitee'
  | 'smartrecruiters'
  | 'solidjobs';

// Single mapping point for provider display. Mirrors the providers
// batch/scan-portals.mjs detectApi() understands — keep the two in sync so the
// Settings panel never labels a company "not scannable" that the scanner would
// in fact scan.
export const PROVIDER_ORDER: AtsProvider[] = [
  'greenhouse',
  'ashby',
  'lever',
  'workable',
  'workday',
  'recruitee',
  'smartrecruiters',
  'solidjobs',
];
export const PROVIDER_LABELS: Record<AtsProvider, string> = {
  greenhouse: 'Greenhouse',
  ashby: 'Ashby',
  lever: 'Lever',
  workable: 'Workable',
  workday: 'Workday',
  recruitee: 'Recruitee',
  smartrecruiters: 'SmartRecruiters',
  solidjobs: 'SolidJobs',
};

// A company with a `parser:` block is scanned by a local script (the
// universal-scanner escape hatch in batch/scan-portals.mjs), not one of the
// built-in ATS feeds. The Settings UI shows a read-only "Custom parser" badge
// and preserves the block — the scripts are agent/editor-authored, never edited
// in the form.
export function hasCustomParser(company: { parser?: { command?: string } }): boolean {
  return Boolean(company.parser?.command);
}

export function detectProvider(company: {
  api?: string;
  careers_url?: string;
}): AtsProvider | null {
  if (company.api?.includes('greenhouse')) return 'greenhouse';
  const url = company.careers_url ?? '';
  if (/jobs\.ashbyhq\.com\/[^/?#]+/.test(url)) return 'ashby';
  if (/jobs\.lever\.co\/[^/?#]+/.test(url)) return 'lever';
  if (/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/[^/?#]+/.test(url)) return 'greenhouse';
  if (/apply\.workable\.com\/[^/?#]+/.test(url) || /https?:\/\/[^.]+\.workable\.com/.test(url))
    return 'workable';
  if (/myworkdayjobs\.com/.test(url)) return 'workday';
  // SolidJobs is checked before Recruitee/SmartRecruiters — its careers_url is
  // the public-api offers endpoint, a distinct host.
  if (/^https:\/\/solid\.jobs\/public-api\/offers\//.test(url)) return 'solidjobs';
  if (/^https:\/\/[a-z0-9][a-z0-9-]*\.recruitee\.com/i.test(url)) return 'recruitee';
  if (/^https:\/\/(?:careers|jobs)\.smartrecruiters\.com\/[^/?#]+/.test(url))
    return 'smartrecruiters';
  return null;
}

export interface AtsSummary {
  /** Total entries in tracked_companies. */
  total: number;
  /** Entries not explicitly disabled (enabled !== false). */
  enabled: number;
  /** Enabled entries with a derivable ATS feed (what the scanner will hit). */
  scannable: number;
  /** Provider → scannable-company count, for the panel breakdown. */
  byProvider: Record<AtsProvider, number>;
}

export function summarizePortals(
  portals: { tracked_companies?: TrackedCompany[] } | null,
): AtsSummary {
  const byProvider: Record<AtsProvider, number> = {
    greenhouse: 0,
    ashby: 0,
    lever: 0,
    workable: 0,
    workday: 0,
    recruitee: 0,
    smartrecruiters: 0,
    solidjobs: 0,
  };
  const companies = portals?.tracked_companies ?? [];
  let enabled = 0;
  let scannable = 0;
  for (const c of companies) {
    if (c.enabled === false) continue;
    enabled++;
    const provider = detectProvider(c);
    if (provider) {
      scannable++;
      byProvider[provider]++;
    }
  }
  return { total: companies.length, enabled, scannable, byProvider };
}

// ── Smart-add derivation ────────────────────────────────────────────────────

export interface DerivedCompany {
  /** null = no zero-token feed derivable ("not scannable" in the UI). */
  provider: AtsProvider | null;
  /** Title-cased slug guess — user-editable after the row is added. */
  name: string;
  careers_url: string;
  /** Greenhouse only: the boards-api JSON endpoint the scanner hits. */
  api?: string;
}

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function firstPathSegment(pathname: string): string | null {
  const seg = pathname.split('/').filter(Boolean)[0];
  return seg ? decodeURIComponent(seg) : null;
}

/**
 * Derive {provider, name, careers_url, api} from a pasted careers URL.
 * Returns null only for input that isn't a valid http(s) URL — an unknown
 * provider still derives a row (provider: null) so the company can be
 * tracked even though the zero-token scanner won't pick it up.
 */
export function deriveCompanyFromUrl(rawUrl: string): DerivedCompany | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  const slug = firstPathSegment(url.pathname);

  // Greenhouse: job-boards(.eu)?.greenhouse.io/{slug} or boards.greenhouse.io
  // → auto-fill the boards-api endpoint (the scanner needs `api` set).
  if (/^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/.test(host) && slug) {
    return {
      provider: 'greenhouse',
      name: titleCaseSlug(slug),
      careers_url: trimmed,
      api: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    };
  }
  // Ashby: jobs.ashbyhq.com/{slug}
  if (host === 'jobs.ashbyhq.com' && slug) {
    return { provider: 'ashby', name: titleCaseSlug(slug), careers_url: trimmed };
  }
  // Lever: jobs.lever.co/{slug}
  if (host === 'jobs.lever.co' && slug) {
    return { provider: 'lever', name: titleCaseSlug(slug), careers_url: trimmed };
  }
  // Workable: apply.workable.com/{slug} or {slug}.workable.com
  if (host === 'apply.workable.com' && slug) {
    return { provider: 'workable', name: titleCaseSlug(slug), careers_url: trimmed };
  }
  const workableSub = host.match(/^([^.]+)\.workable\.com$/);
  if (workableSub && workableSub[1] !== 'apply' && workableSub[1] !== 'www') {
    return { provider: 'workable', name: titleCaseSlug(workableSub[1]), careers_url: trimmed };
  }
  // Workday: {tenant}.{shard}.myworkdayjobs.com/{site} — tenant names the company.
  const workday = host.match(/^([^.]+)\..*myworkdayjobs\.com$/);
  if (workday) {
    return { provider: 'workday', name: titleCaseSlug(workday[1]), careers_url: trimmed };
  }
  // SolidJobs: solid.jobs/public-api/offers/{division} — the careers_url IS the
  // public-api endpoint; name the row after the division segment.
  if (host === 'solid.jobs' && url.pathname.startsWith('/public-api/offers/')) {
    const division = url.pathname.split('/').filter(Boolean)[2];
    return {
      provider: 'solidjobs',
      name: division ? titleCaseSlug(decodeURIComponent(division)) : 'SolidJobs',
      careers_url: trimmed,
    };
  }
  // Recruitee: {slug}.recruitee.com — the subdomain names the company.
  const recruitee = host.match(/^([a-z0-9][a-z0-9-]*)\.recruitee\.com$/);
  if (recruitee) {
    return { provider: 'recruitee', name: titleCaseSlug(recruitee[1]), careers_url: trimmed };
  }
  // SmartRecruiters: (careers|jobs).smartrecruiters.com/{slug}
  if ((host === 'careers.smartrecruiters.com' || host === 'jobs.smartrecruiters.com') && slug) {
    return { provider: 'smartrecruiters', name: titleCaseSlug(slug), careers_url: trimmed };
  }

  // Unknown provider: still derive a row — name guess from the registrable
  // host label (e.g. careers.example.com → "Example").
  const labels = host.split('.');
  const nameLabel = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  return { provider: null, name: titleCaseSlug(nameLabel), careers_url: trimmed };
}
