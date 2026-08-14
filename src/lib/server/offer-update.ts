// src/lib/server/offer-update.ts
//
// Confirm-gated "edit tracked offer" logic (issue #74): one validated
// change-set covering structured metadata (frontmatter and/or tracker cells)
// plus sequential report-body find/replace edits. validateOfferUpdate is
// pure (no writes) and runs twice — at propose time (action route, so a
// doomed confirm card is never shown) and again at apply time against fresh
// reads. applyOfferUpdate is the only writer.

import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportFrontmatter } from '../schemas/reports';
import { loadApplications } from './applications';
import { atomicWrite } from './atomic-write';
import { VALID_SENIORITY, VALID_WORK_MODE } from './report-schema';
import { parseFrontmatter, reportPathForNum, saveReport } from './reports';

export interface OfferBodyEdit {
  oldText: string;
  newText: string;
}

export interface OfferFieldChange {
  field: string;
  from: string;
  to: string;
  target: 'frontmatter' | 'tracker' | 'both';
}

export interface OfferUpdateChangeSet {
  num: number;
  filePath: string;
  company: string;
  fieldChanges: OfferFieldChange[];
  bodyEditCount: number;
  nextFrontmatter: ReportFrontmatter;
  nextBody: string;
  trackerCells: { company?: string; role?: string; posted?: string };
}

export type OfferUpdateValidation =
  | { ok: true; changeSet: OfferUpdateChangeSet }
  | { ok: false; error: string };

// Fields owned by other actions or derived by the pipeline. Editing them here
// would corrupt tracker parsing (status/score/date) or lie about generated
// artifacts, so each rejects with a pointer where one exists.
const PROTECTED_FIELD_HINTS: Record<string, string> = {
  status: 'status is owned by set_status — use that tool instead',
  state: 'state is derived from the evaluation depth and cannot be edited',
  score: 'score is produced by evaluation — re-run evaluate via start_job',
  score_breakdown: 'score_breakdown is produced by evaluation',
  num: 'num is the offer identity and cannot change',
  date: 'date is the scan/add timestamp and cannot change',
  jd_path: 'jd_path is pipeline-managed',
  jd_hash: 'jd_hash is pipeline-managed',
  source_kind: 'source_kind is pipeline-managed',
  cv_pdf_path: 'artifact paths are pipeline-managed',
  cover_letter_path: 'artifact paths are pipeline-managed',
  company_logo: 'company_logo is derived',
  has_company_research: 'has_* flags are derived',
  has_interview_process: 'has_* flags are derived',
  has_outreach: 'has_* flags are derived',
  has_negotiation: 'has_* flags are derived',
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Long fields have derived "short" siblings (and comp's comp_range) that the
// projections in src/lib/server/reports.ts (loc_short ?? loc, archetype_short
// ?? archetype, seniority_short ?? shortSeniority(seniority), comp_range ??
// comp) and src/features/report/report-types.ts (comp_short/seniority_short/
// loc_short/archetype_short fallback chains) PREFER over the long value when
// present. If we only overwrite the long field, those stale siblings keep
// winning the fallback and the edit never becomes visible. Delete the
// siblings here whenever their long source changes so the fallback chains
// recompute from the fresh value.
const DERIVED_SHORT_FIELDS: Record<string, readonly string[]> = {
  seniority: ['seniority_short'],
  location: ['loc_short'],
  locations: ['loc_short'],
  archetype: ['archetype_short'],
  comp: ['comp_short', 'comp_range'],
};

/** Collapse whitespace; reject '|' (pipe-table cells) and overlong values. */
function cleanCell(field: string, value: unknown, max: number): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const v = value.replace(/\s+/g, ' ').trim();
  if (!v) throw new Error(`${field} cannot be empty`);
  if (v.includes('|')) throw new Error(`${field} cannot contain '|'`);
  if (v.length > max) throw new Error(`${field} is too long (max ${max} chars)`);
  return v;
}

function cleanText(field: string, value: unknown, max: number): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const v = value.trim();
  if (v.length > max) throw new Error(`${field} is too long (max ${max} chars)`);
  return v;
}

// field → { target, normalize } — normalize throws with a user-facing message.
const EDITABLE_FIELDS: Record<
  string,
  { target: OfferFieldChange['target']; normalize: (v: unknown) => unknown }
> = {
  url: {
    target: 'frontmatter',
    normalize: v => {
      if (typeof v !== 'string') throw new Error('url must be a string');
      let parsed: URL;
      try {
        parsed = new URL(v.trim());
      } catch {
        throw new Error(`url must be a valid http(s) URL: ${v}`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`url must be a valid http(s) URL: ${v}`);
      }
      return parsed.toString();
    },
  },
  company: { target: 'both', normalize: v => cleanCell('company', v, 160) },
  role: { target: 'both', normalize: v => cleanCell('role', v, 240) },
  posted: {
    target: 'both',
    normalize: v => {
      if (typeof v !== 'string' || !ISO_DATE_RE.test(v.trim())) {
        throw new Error(`posted must be an ISO date (YYYY-MM-DD): ${String(v)}`);
      }
      return v.trim();
    },
  },
  archetype: { target: 'frontmatter', normalize: v => cleanText('archetype', v, 240) },
  seniority: {
    target: 'frontmatter',
    normalize: v => {
      if (typeof v !== 'string' || (v !== '' && !VALID_SENIORITY.includes(v))) {
        throw new Error(`seniority must be one of: ${VALID_SENIORITY.join(', ')}`);
      }
      return v;
    },
  },
  work_mode: {
    target: 'frontmatter',
    normalize: v => {
      if (typeof v !== 'string' || (v !== '' && !VALID_WORK_MODE.includes(v))) {
        throw new Error(`work_mode must be one of: ${VALID_WORK_MODE.join(', ')}`);
      }
      return v;
    },
  },
  location: { target: 'frontmatter', normalize: v => cleanText('location', v, 240) },
  comp: { target: 'frontmatter', normalize: v => cleanText('comp', v, 240) },
  legitimacy: { target: 'frontmatter', normalize: v => cleanText('legitimacy', v, 240) },
  tldr: { target: 'frontmatter', normalize: v => cleanText('tldr', v, 500) },
  remote: {
    target: 'frontmatter',
    normalize: v => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return cleanText('remote', v, 120);
      throw new Error('remote must be a boolean or a string');
    },
  },
  locations: {
    target: 'frontmatter',
    normalize: v => {
      if (typeof v === 'string') return cleanText('locations', v, 500);
      if (Array.isArray(v)) return v.map((item, i) => cleanCell(`locations[${i}]`, item, 240));
      throw new Error('locations must be a string or an array of strings');
    },
  },
};

/** Display string for card copy + no-op comparison. */
function displayValue(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

export function validateOfferUpdate(
  root: string,
  num: number,
  fields: Record<string, unknown> | undefined,
  bodyEdits: OfferBodyEdit[] | undefined,
): OfferUpdateValidation {
  const row = loadApplications(root).find(r => r.num === num);
  if (!row) return { ok: false, error: `offer #${num} not found in the tracker` };
  const filePath = reportPathForNum(root, num);
  if (!filePath) return { ok: false, error: `no report on disk for offer #${num}` };

  let current: string;
  try {
    current = readFileSync(filePath, 'utf-8');
  } catch {
    return { ok: false, error: `no report on disk for offer #${num}` };
  }
  let parsed: { frontmatter: ReportFrontmatter; body: string };
  try {
    parsed = parseFrontmatter(current);
  } catch {
    return { ok: false, error: 'report is not in frontmatter format' };
  }

  const fieldChanges: OfferFieldChange[] = [];
  const nextFrontmatter = { ...parsed.frontmatter };
  const trackerCells: OfferUpdateChangeSet['trackerCells'] = {};

  for (const [field, rawValue] of Object.entries(fields ?? {})) {
    // Object.hasOwn (not `in` / bracket indexing) so a field name shadowing
    // an inherited Object.prototype member (e.g. "toString", "constructor")
    // can't walk the prototype chain and produce a nonsense hint or slip
    // past the "unknown field" check.
    if (Object.hasOwn(PROTECTED_FIELD_HINTS, field)) {
      return { ok: false, error: `field not editable: ${field} — ${PROTECTED_FIELD_HINTS[field]}` };
    }
    if (!Object.hasOwn(EDITABLE_FIELDS, field))
      return { ok: false, error: `unknown field: ${field}` };
    const def = EDITABLE_FIELDS[field];
    let value: unknown;
    try {
      value = def.normalize(rawValue);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const fmCurrent = displayValue((parsed.frontmatter as Record<string, unknown>)[field]);
    const to = displayValue(value);
    // For both-target fields the tracker cell may have drifted from the
    // frontmatter; a "no-op" only when BOTH stores already hold the value.
    const trackerCurrent =
      field === 'company'
        ? row.company
        : field === 'role'
          ? row.role
          : field === 'posted'
            ? (row.posted ?? '')
            : null;
    const isNoop = fmCurrent === to && (trackerCurrent === null || trackerCurrent === to);
    if (isNoop) continue;
    (nextFrontmatter as Record<string, unknown>)[field] = value;
    for (const derived of DERIVED_SHORT_FIELDS[field] ?? []) {
      delete (nextFrontmatter as Record<string, unknown>)[derived];
    }
    if (def.target === 'both') {
      trackerCells[field as keyof OfferUpdateChangeSet['trackerCells']] = to;
    }
    fieldChanges.push({ field, from: fmCurrent, to, target: def.target });
  }

  // Sequential body edits: each must match the PROGRESSIVELY edited body
  // exactly once — same contract and wording as applyReportBodyEdit.
  let nextBody = parsed.body;
  for (const edit of bodyEdits ?? []) {
    if (!edit.oldText) return { ok: false, error: `text to replace not found in report #${num}` };
    const count = nextBody.split(edit.oldText).length - 1;
    if (count === 0) return { ok: false, error: `text to replace not found in report #${num}` };
    if (count > 1) {
      return {
        ok: false,
        error: `old_text matches ${count} places — add surrounding context to make it unique`,
      };
    }
    nextBody = nextBody.replace(edit.oldText, () => edit.newText);
  }

  const bodyEditCount = bodyEdits?.length ?? 0;
  if (fieldChanges.length === 0 && bodyEditCount === 0) {
    return { ok: false, error: 'nothing to change' };
  }

  return {
    ok: true,
    changeSet: {
      num,
      filePath,
      company: row.company,
      fieldChanges,
      bodyEditCount,
      nextFrontmatter,
      nextBody,
      trackerCells,
    },
  };
}

export interface OfferUpdateResult {
  num: number;
  changed: string[];
  bodyEditCount: number;
}

// Tracker column indexes after `line.split('|')`:
// ['', num, date, company, role, score, status, pdf, report, notes, posted?, '']
const TRACKER_COL = { company: 3, role: 4, posted: 10 } as const;

/**
 * Apply a validated offer update. Re-validates against fresh reads (the
 * confirm card may have sat open while files changed — a stale oldText or a
 * vanished row fails HERE instead of clobbering). Writes the report first,
 * then the tracker; a tracker failure restores the prior report bytes so the
 * two files never end up torn. Throws Error(message) on any failure.
 */
export function applyOfferUpdate(
  root: string,
  num: number,
  fields: Record<string, unknown> | undefined,
  bodyEdits: OfferBodyEdit[] | undefined,
): OfferUpdateResult {
  const validated = validateOfferUpdate(root, num, fields, bodyEdits);
  if (!validated.ok) throw new Error(validated.error);
  const { changeSet } = validated;

  const reportBefore = readFileSync(changeSet.filePath, 'utf-8');
  saveReport({
    filePath: changeSet.filePath,
    frontmatter: changeSet.nextFrontmatter,
    body: changeSet.nextBody,
  });

  const cells = Object.entries(changeSet.trackerCells) as Array<[keyof typeof TRACKER_COL, string]>;
  if (cells.length > 0) {
    try {
      const trackerPath = join(root, 'data/applications.md');
      const lines = readFileSync(trackerPath, 'utf-8').split('\n');
      const idx = lines.findIndex(line => {
        if (!line.startsWith('|')) return false;
        const parts = line.split('|').map(s => s.trim());
        return parts.length >= 9 && parseInt(parts[1]) === num;
      });
      if (idx === -1) throw new Error(`num not found: ${num}`);
      const cols = lines[idx].split('|');
      for (const [field, value] of cells) {
        const col = TRACKER_COL[field];
        if (field === 'posted' && cols.length < 12) {
          // Legacy 9-column row (11 split parts): grow it by inserting the
          // Posted cell before the trailing '' so the row stays well-formed.
          cols.splice(cols.length - 1, 0, ` ${value} `);
        } else {
          cols[col] = ` ${value} `;
        }
      }
      lines[idx] = cols.join('|');
      atomicWrite(trackerPath, lines.join('\n'));
    } catch (err) {
      // Compensate: never leave the report updated while the tracker isn't.
      atomicWrite(changeSet.filePath, reportBefore);
      throw err;
    }
  }

  return {
    num,
    changed: changeSet.fieldChanges.map(c => c.field),
    bodyEditCount: changeSet.bodyEditCount,
  };
}
