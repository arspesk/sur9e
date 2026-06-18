// Pure (no Node APIs) — imported by the shared Zod profile schema, so it must
// stay client-safe. Converts every legacy apply_answers shape into the
// canonical ordered list of { question, answer } pairs and drops fully-empty
// rows (the both-blank trim rule), so the same call governs read, save, and
// the API surface.

export interface ApplyAnswer {
  question: string;
  answer: string;
}

/** Legacy structured key → human question label. Object order is the migrated
 *  list order (structured keys first, then additional_info lines). */
export const APPLY_ANSWER_LABELS: Record<string, string> = {
  work_authorization_us: 'Work authorization (US)',
  visa_sponsorship_required: 'Require visa sponsorship?',
  current_employer: 'Current employer',
  current_title: 'Current title',
  most_recent_school: 'Most recent school',
  most_recent_degree: 'Most recent degree',
  previously_employed_by_target_company: 'Previously employed here?',
  plans_to_work_remotely: 'Plan to work remotely?',
  timezone: 'Timezone',
  whatsapp_recruiting_opt_in: 'WhatsApp recruiting opt-in',
};

/** Inserted by the "Add common questions" button (questions only, blank
 *  answers). Idempotent insertion is the UI's job. */
export const COMMON_QUESTIONS: string[] = [
  'Work authorization (US)',
  'Require visa sponsorship?',
  'Gender / sex',
  'Race / ethnicity',
  'Sexual orientation',
  'Transgender',
  'Disability',
  'Veteran status',
  'Notice period / earliest start date',
  'How did you hear about us?',
  'Willing to relocate',
];

const trim = (v: unknown): string => String(v ?? '').trim();

export function normalizeApplyAnswers(raw: unknown): ApplyAnswer[] {
  if (raw == null || typeof raw !== 'object') return [];

  if (Array.isArray(raw)) {
    return raw
      .map((item): ApplyAnswer => {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          return { question: trim(o.question), answer: trim(o.answer) };
        }
        return { question: '', answer: trim(item) };
      })
      .filter(p => p.question !== '' || p.answer !== '');
  }

  const o = raw as Record<string, unknown>;
  const out: ApplyAnswer[] = [];
  for (const [key, label] of Object.entries(APPLY_ANSWER_LABELS)) {
    if (trim(o[key]) !== '') out.push({ question: label, answer: trim(o[key]) });
  }
  if (typeof o.additional_info === 'string') {
    for (const line of o.additional_info.split('\n')) {
      const t = line.trim();
      if (t === '') continue;
      const idx = t.indexOf(':');
      if (idx === -1) out.push({ question: '', answer: t });
      else out.push({ question: t.slice(0, idx).trim(), answer: t.slice(idx + 1).trim() });
    }
  }
  return out;
}
