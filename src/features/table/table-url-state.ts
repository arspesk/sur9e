// URL serialization / deserialization for table filter state.

import { APPLICATION_STATUSES } from '@/lib/schemas/applications';
import {
  COMP_MAX,
  DEFAULTS,
  SENIORITY_ORDER,
  type TableFilterState,
  WORK_MODE_ORDER,
} from './table-filtering';

const VALID_SORT_KEYS = [
  'num',
  'score',
  'date',
  'posted',
  'company',
  'role',
  'status',
  'comp',
  'loc',
  'archetype',
  'seniority',
  'work_mode',
];
const VALID_DATES = ['all', '7d', '30d', '90d'];
const VALID_STATUSES: readonly string[] = APPLICATION_STATUSES;
const VALID_SENIORITY: readonly string[] = SENIORITY_ORDER;
const VALID_WORK_MODE: readonly string[] = WORK_MODE_ORDER;

export function serializeURL(state: TableFilterState): string {
  const params: [string, string][] = [];
  if (state.q) params.push(['q', state.q]);
  if (state.sort.key !== DEFAULTS.sort.key || state.sort.dir !== DEFAULTS.sort.dir) {
    params.push(['sort', `${state.sort.key}:${state.sort.dir}`]);
  }
  if (state.score.min !== DEFAULTS.score.min || state.score.max !== DEFAULTS.score.max) {
    params.push(['score', `${state.score.min}-${state.score.max}`]);
  }
  if (state.comp.min !== DEFAULTS.comp.min || state.comp.max !== DEFAULTS.comp.max) {
    params.push(['comp', `${state.comp.min}-${state.comp.max}`]);
  }
  if (state.status.length) params.push(['status', state.status.join(',')]);
  if (state.archetype.length) params.push(['archetype', state.archetype.join(',')]);
  if (state.seniority.length) params.push(['seniority', state.seniority.join(',')]);
  if (state.work_mode.length) params.push(['work_mode', state.work_mode.join(',')]);
  if (state.date !== DEFAULTS.date) params.push(['date', state.date]);
  return params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

export function parseURL(qs: string | null | undefined): TableFilterState {
  const out: TableFilterState = {
    q: DEFAULTS.q,
    sort: { ...DEFAULTS.sort },
    score: { ...DEFAULTS.score },
    comp: { ...DEFAULTS.comp },
    status: [],
    archetype: [],
    seniority: [],
    work_mode: [],
    date: DEFAULTS.date,
  };
  if (!qs) return out;
  const params = new URLSearchParams(qs.replace(/^\?/, ''));

  const q = params.get('q');
  if (q !== null) out.q = q;

  const sortRaw = params.get('sort');
  if (sortRaw) {
    const [k, d] = sortRaw.split(':');
    if (VALID_SORT_KEYS.includes(k) && (d === 'asc' || d === 'desc')) {
      out.sort = { key: k, dir: d as 'asc' | 'desc' };
    }
  }

  const scoreRaw = params.get('score');
  if (scoreRaw) {
    const m = scoreRaw.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
    if (m) {
      const min = Number(m[1]);
      const max = Number(m[2]);
      if (min >= 0 && max <= 5 && min <= max) out.score = { min, max };
    }
  }

  const compRaw = params.get('comp');
  if (compRaw) {
    const m = compRaw.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (m) {
      const min = Number(m[1]);
      const max = Number(m[2]);
      if (min >= 0 && max <= COMP_MAX && min <= max) out.comp = { min, max };
    }
  }

  const statusRaw = params.get('status');
  if (statusRaw) {
    out.status = statusRaw.split(',').filter(s => VALID_STATUSES.includes(s));
  }

  const archetypeRaw = params.get('archetype');
  if (archetypeRaw) {
    out.archetype = archetypeRaw.split(',').filter(Boolean);
  }

  const seniorityRaw = params.get('seniority');
  if (seniorityRaw) {
    out.seniority = seniorityRaw.split(',').filter(s => VALID_SENIORITY.includes(s));
  }

  const workModeRaw = params.get('work_mode');
  if (workModeRaw) {
    out.work_mode = workModeRaw.split(',').filter(s => VALID_WORK_MODE.includes(s));
  }

  const dateRaw = params.get('date');
  if (dateRaw && VALID_DATES.includes(dateRaw)) out.date = dateRaw;

  return out;
}

export interface FilterPill {
  key: string;
  label: string;
  reset: Partial<TableFilterState>;
}

export function getActivePills(state: TableFilterState): FilterPill[] {
  const pills: FilterPill[] = [];
  if (state.score.min !== DEFAULTS.score.min || state.score.max !== DEFAULTS.score.max) {
    pills.push({
      key: 'score',
      label: `Score ${state.score.min}–${state.score.max}`,
      reset: { score: { ...DEFAULTS.score } },
    });
  }
  if (state.comp.min !== DEFAULTS.comp.min || state.comp.max !== DEFAULTS.comp.max) {
    const hi = state.comp.max >= COMP_MAX ? `${COMP_MAX}K+` : `${state.comp.max}K`;
    pills.push({
      key: 'comp',
      label: `Salary $${state.comp.min}K–$${hi}`,
      reset: { comp: { ...DEFAULTS.comp } },
    });
  }
  if (state.status.length) {
    pills.push({
      key: 'status',
      label: `Status: ${state.status.length}`,
      reset: { status: [] },
    });
  }
  if (state.archetype.length) {
    pills.push({
      key: 'archetype',
      label:
        state.archetype.length === 1 ? state.archetype[0] : `Archetype: ${state.archetype.length}`,
      reset: { archetype: [] },
    });
  }
  if (state.date !== DEFAULTS.date) {
    const labels: Record<string, string> = {
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
      '90d': 'Last 90 days',
    };
    pills.push({
      key: 'date',
      label: labels[state.date] ?? state.date,
      reset: { date: DEFAULTS.date },
    });
  }
  if (state.seniority.length) {
    pills.push({
      key: 'seniority',
      label:
        state.seniority.length === 1 ? state.seniority[0] : `Seniority: ${state.seniority.length}`,
      reset: { seniority: [] },
    });
  }
  if (state.work_mode.length) {
    pills.push({
      key: 'work_mode',
      label:
        state.work_mode.length === 1 ? state.work_mode[0] : `Work mode: ${state.work_mode.length}`,
      reset: { work_mode: [] },
    });
  }
  return pills;
}
