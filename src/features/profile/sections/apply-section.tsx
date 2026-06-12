'use client';

// sections/apply-section.tsx
// Fields: apply_answers.additional_info (textarea)
//
// The structured yes/no answers (work authorization, sponsorship,
// employer/title, school/degree, …) live in profile.yml under
// `apply_answers` and are appended by the apply assistant as the user
// confirms them; this section surfaces the free-form remainder.

import { useFormContext } from 'react-hook-form';
import { Textarea } from '@/components/primitives';
import type { ProfileFormValues } from '../schemas';

const ADDITIONAL_INFO_PLACEHOLDER = [
  'One answer per line, e.g.:',
  'Gender / sex: …',
  'Race / ethnicity: …',
  'Sexual orientation: …',
  'Transgender: …',
  'Disability: …',
  'Veteran status: …',
  'Work authorization: …',
  'Visa sponsorship needed: …',
  'Notice period / earliest start date: …',
  'How did you hear about us: …',
  'Security clearance: …',
  'Willing to relocate: …',
].join('\n');

export function ApplySection() {
  const { register } = useFormContext<ProfileFormValues>();

  return (
    <section id="apply" className="form-section anim-enter">
      <h2 className="form-section__title">Application questions</h2>
      <p className="form-section__desc">
        Standing answers to recurring application-form questions — self-identification, work
        authorization, notice period, and the like. One answer per line; the apply assistant reads
        these instead of asking you on every form.
      </p>
      <div className="form-grid">
        <div className="form-field">
          <Textarea
            id="profile-apply-additional-info"
            rows={14}
            aria-label="Application question answers"
            data-key="apply_answers.additional_info"
            placeholder={ADDITIONAL_INFO_PLACEHOLDER}
            {...register('apply_answers.additional_info')}
          />
        </div>
      </div>
    </section>
  );
}
