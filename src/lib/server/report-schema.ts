// src/lib/server/report-schema.ts
//
// Single source of truth for the offer-report contract. Inlined from
// report-schema.mjs. Types are explicit; validators + constants are
// inlined directly.
//
// Caps are intentional to control verbosity (see spec §2).

export const SCHEMA_DEFAULTS: Readonly<Record<string, unknown>> = {
  // Role Summary
  archetype: '',
  archetype_detail: '',
  domain: '',
  seniority: '',
  remote: '',
  locations: '',
  team: '',
  comp: '',
  tldr: '',
  // Short chip-friendly variants
  archetype_short: '',
  loc_short: '',
  comp_short: '',
  seniority_short: '',
  date_short: '',
  // CV Match
  cv_match: [], // [{jd, cv, strength}], cap 8
  gaps: [], // [{title, severity, mitigation}], cap 3
  verdict: '',
  // Level & Strategy
  detected_level: '',
  natural_level: '',
  sell_senior: [], // strings, cap 3
  if_downleveled: [], // strings, cap 3
  // Compensation
  comp_points: [], // [{source, value}], cap 5
  analysis: '',
  demand: '',
  comp_verdict: '', // 'top_quartile' | 'mid_market' | 'below_market' | 'not_disclosed'
  // Personalization
  cv_adjustments: [], // [{section, current, proposed, why}], cap 3
  linkedin: [], // strings, cap 3
  // Interview Prep
  stars: [], // [{theme, s, t, a, r, reflection}], cap 3
  // Posting Legitimacy
  tier: 'likely_legitimate',
  notes: '',
  // Score breakdown matrix (drives radar in Snapshot + drawer)
  score_breakdown: {
    cv_match: 0,
    seniority: 0,
    compensation: 0,
    domain: 0,
    geo: 0,
    legitimacy: 0,
  },
};

export const SCHEMA_CAPS: Readonly<Record<string, number>> = {
  cv_match: 8,
  gaps: 3,
  sell_senior: 3,
  if_downleveled: 3,
  comp_points: 5,
  cv_adjustments: 3,
  linkedin: 3,
  stars: 3,
};

export const SHORT_FIELD_CAPS: Readonly<Record<string, number>> = {
  archetype_short: 24,
  loc_short: 16,
  comp_short: 14,
  seniority_short: 14,
  date_short: 8,
};

export const STRING_FIELD_CAPS: Readonly<Record<string, number>> = {
  tldr: 200,
  verdict: 240,
  detected_level: 180,
  natural_level: 180,
  analysis: 300,
  demand: 180,
  notes: 200,
  archetype_detail: 80,
  domain: 80,
  team: 60,
};

export const ROW_FIELD_CAPS: Readonly<Record<string, Record<string, number>>> = {
  cv_match: { jd: 80, cv: 160 },
  gaps: { title: 80, mitigation: 140 },
  stars: { theme: 80, s: 140, t: 140, a: 220, r: 220, reflection: 220 },
  cv_adjustments: { section: 60, current: 200, proposed: 280, why: 140 },
  comp_points: { source: 60, value: 60 },
};

export const VALID_STRENGTH: readonly string[] = ['direct', 'strong', 'adjacent', 'gap'];
export const VALID_SEVERITY: readonly string[] = ['low', 'medium', 'high', 'hard_blocker'];
export const VALID_TIER: readonly string[] = [
  'high_confidence',
  'likely_legitimate',
  'uncertain',
  'suspicious',
  'scam',
];
export const VALID_COMP_VERDICT: readonly string[] = [
  'top_quartile',
  'mid_market',
  'below_market',
  'not_disclosed',
];

export const VALID_SENIORITY: readonly string[] = ['Junior', 'Mid', 'Senior', 'Staff', 'Principal'];
export const VALID_WORK_MODE: readonly string[] = ['Remote', 'Hybrid', 'On-site'];

// Map fuzzy AI/LinkedIn phrasings onto the seniority enum. Returns '' when
// nothing matches — callers keep the field empty rather than guessing, and
// the user can pick the right value from the dropdown.
export function coerceSeniority(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (!s) return '';
  const exact = VALID_SENIORITY.find(x => x.toLowerCase() === s);
  if (exact) return exact;
  if (/\bprincipal\b/.test(s)) return 'Principal';
  if (/\bstaff\b/.test(s)) return 'Staff';
  if (/(mid[-\s]?senior|^senior|\bsr\.?\b|\blead\b)/.test(s)) return 'Senior';
  if (/(junior|entry|intern|associate|\bjr\.?\b|graduate)/.test(s)) return 'Junior';
  if (/\bmid([-\s]?level)?\b/.test(s)) return 'Mid';
  return '';
}

// Map fuzzy work-mode phrasings onto the enum.
export function coerceWorkMode(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (!s) return '';
  if (/(hybrid|flex)/.test(s)) return 'Hybrid';
  if (/(remote|wfh|work from home|distributed)/.test(s)) return 'Remote';
  if (/(on[-\s]?site|in[-\s]?office|in[-\s]?person)/.test(s)) return 'On-site';
  return '';
}

// City-only location for the header chip. Takes the first location (string or
// first array element), drops any "(On-site)"-style parenthetical and the
// trailing ", CA"/country, and trims. "Los Angeles, CA" → "Los Angeles";
// "LA (On-site)" → "LA". Shared by the report hero + the table/kanban summary
// so every surface resolves the same value (sync).
export function cityFromLocations(loc: unknown): string {
  const first = Array.isArray(loc) ? (loc[0] ?? '') : (loc ?? '');
  return String(first)
    .replace(/\([^)]*\)/g, '')
    .split(',')[0]
    .trim();
}

// Top-level string fields the AI sometimes emits as booleans, arrays, or
// numbers. Coerce to a clean string so downstream renderers don't break.
const STRING_FIELDS = [
  'archetype',
  'archetype_detail',
  'domain',
  'seniority',
  'remote',
  'locations',
  'team',
  'comp',
  'tldr',
  'verdict',
  'detected_level',
  'natural_level',
  'analysis',
  'demand',
  'notes',
];

function truncate(s: unknown, max: number): string {
  const str = String(s == null ? '' : s);
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + '…';
}

function coerceShort(v: unknown, max: number): string {
  return truncate(coerceString(v), max);
}

function coerceString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v))
    return v
      .map(x => coerceString(x))
      .filter(Boolean)
      .join(', ');
  return String(v);
}

/**
 * Validate parsed YAML against the schema. Returns a new validated object
 * (does not mutate `raw`). Caps arrays, fills defaults, coerces text fields.
 *
 * Never throws — silently coerces invalid values to defaults.
 */
export function validateReport(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') raw = {};
  const out: Record<string, unknown> = { ...SCHEMA_DEFAULTS, ...(raw as Record<string, unknown>) };

  // Coerce text fields (AI sometimes emits booleans / arrays / nulls)
  for (const k of STRING_FIELDS) out[k] = coerceString(out[k]);

  // Apply short-field caps (truncate-with-ellipsis) — these fields drive
  // tracker-row columns (archetype_short, loc_short, comp_short, etc.) where
  // the table layout assumes strict character widths. Keep the caps here.
  for (const [k, max] of Object.entries(SHORT_FIELD_CAPS)) {
    out[k] = coerceShort(out[k], max);
  }

  // Prose / row-field char caps INTENTIONALLY removed — they were clipping
  // legitimately-long content in the report drawer + full report (e.g.
  // "Provide technical consultation during pre-…"). The AI prompt is the
  // primary enforcement; if the AI runs long, the layout handles wrap.
  // Reach for these caps again only if a runaway AI output starts breaking
  // layouts in practice. The constants STRING_FIELD_CAPS / ROW_FIELD_CAPS
  // remain exported for future reintroduction or external use.

  // Cap arrays
  for (const [key, max] of Object.entries(SCHEMA_CAPS)) {
    if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).slice(0, max);
    else out[key] = [];
  }

  // Validate enums (fall back to default if invalid)
  if (!VALID_TIER.includes(out.tier as string)) out.tier = 'likely_legitimate';
  if (out.comp_verdict && !VALID_COMP_VERDICT.includes(out.comp_verdict as string))
    out.comp_verdict = '';

  // Coerce cv_match (no truncation; just strength enum + string coercion)
  out.cv_match = (out.cv_match as unknown[]).map(m => {
    const item = m as Record<string, unknown> | null | undefined;
    return {
      jd: String(item?.jd || ''),
      cv: String(item?.cv || ''),
      strength: VALID_STRENGTH.includes(item?.strength as string) ? item?.strength : 'adjacent',
    };
  });

  // Coerce gaps (no truncation)
  out.gaps = (out.gaps as unknown[]).map(g => {
    const item = g as Record<string, unknown> | null | undefined;
    return {
      title: String(item?.title || ''),
      severity: VALID_SEVERITY.includes(item?.severity as string) ? item?.severity : 'low',
      mitigation: String(item?.mitigation || ''),
    };
  });

  // Coerce stars (no truncation)
  out.stars = (out.stars as unknown[]).map(s => {
    const item = s as Record<string, unknown> | null | undefined;
    return {
      theme: String(item?.theme || ''),
      s: String(item?.s || ''),
      t: String(item?.t || ''),
      a: String(item?.a || ''),
      r: String(item?.r || ''),
      reflection: String(item?.reflection || ''),
    };
  });

  // Coerce cv_adjustments (no truncation)
  out.cv_adjustments = (out.cv_adjustments as unknown[]).map(c => {
    const item = c as Record<string, unknown> | null | undefined;
    return {
      section: String(item?.section || ''),
      current: String(item?.current || ''),
      proposed: String(item?.proposed || ''),
      why: String(item?.why || ''),
    };
  });

  // Coerce comp_points (no truncation)
  out.comp_points = (out.comp_points as unknown[]).map(p => {
    const item = p as Record<string, unknown> | null | undefined;
    return {
      source: String(item?.source || ''),
      value: String(item?.value || ''),
    };
  });

  // Coerce score_breakdown — clamp 0..5
  const sb = (out.score_breakdown || {}) as Record<string, unknown>;
  out.score_breakdown = {
    cv_match: clamp05(sb.cv_match),
    seniority: clamp05(sb.seniority),
    compensation: clamp05(sb.compensation),
    domain: clamp05(sb.domain),
    geo: clamp05(sb.geo),
    legitimacy: clamp05(sb.legitimacy),
  };

  // Coerce list-of-strings
  out.sell_senior = (out.sell_senior as unknown[]).map(s => String(s || ''));
  out.if_downleveled = (out.if_downleveled as unknown[]).map(s => String(s || ''));
  out.linkedin = (out.linkedin as unknown[]).map(s => String(s || ''));

  return out;
}

function clamp05(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, n));
}
