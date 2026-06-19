'use client';

// sections/apply-section.tsx — "Apply answers" Q&A row editor.
// Each row is one { question, answer } pair, persisted as one profile.yml list
// item. Rows reuse the shared .form-rows / .form-row / .row-cell /
// .form-row__remove / .form-row__add styling (same as the archetypes /
// proof-points / languages rows) so the inputs and remove button match the
// rest of the profile. The schema preprocess (normalizeApplyAnswers) drops
// both-blank rows on save, so no trim logic is needed here.

import type { Control } from 'react-hook-form';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { Input } from '@/components/primitives';
import { COMMON_QUESTIONS } from '@/lib/schemas/apply-answers';
import type { ProfileFormValues } from '../schemas';

// react-hook-form's FieldArrayPath constraint requires the form values type
// to NOT carry an index signature (Zod's .passthrough() adds one). Cast to a
// plain structural type so useFieldArray can resolve 'apply_answers' as an
// ArrayPath and infer the correct element type.
//
// Why useFieldArray here and not the shared _widgets/ControlledRowList: that
// widget is Controller-based (so it avoids this cast) but assumes a single
// add button and a typed `kind` with Select-backed columns. This section
// needs two add buttons (+ Add answer / + Add common questions) over two
// free-text columns, so useFieldArray with stable field.id row keys fits
// better; we reuse the widget's .form-row CSS for visual parity instead.
type ApplySectionFormValues = {
  apply_answers: { question: string; answer: string }[];
};

export function ApplySection() {
  const { control, register, getValues } = useFormContext<ProfileFormValues>();
  const { fields, append, remove } = useFieldArray({
    control: control as unknown as Control<ApplySectionFormValues>,
    name: 'apply_answers',
  });

  function addCommonQuestions() {
    // Idempotent by EXACT (case-insensitive) question match — appends only
    // labels not already present. Near-duplicate wording from a free-text
    // legacy migration (e.g. "Gender" vs "Gender / sex") won't be caught;
    // acceptable since the data model tolerates duplicate questions.
    const existing = new Set(
      (getValues('apply_answers') ?? []).map(a => (a?.question ?? '').trim().toLowerCase()),
    );
    for (const q of COMMON_QUESTIONS) {
      if (!existing.has(q.toLowerCase())) append({ question: q, answer: '' });
    }
  }

  return (
    <section id="apply" className="form-section anim-enter">
      <h2 className="form-section__title">Apply answers</h2>
      <p className="form-section__desc">
        Standing answers the apply assistant reuses on every form — work authorization,
        self-identification, notice period, and the like. Add any question your applications keep
        asking.
      </p>

      <div className="form-rows">
        {fields.map((field, i) => (
          <div className="form-row" data-row-idx={i} key={field.id}>
            <Input
              className="row-cell"
              aria-label={`Question ${i + 1}`}
              placeholder="Question"
              {...register(`apply_answers.${i}.question` as const)}
            />
            <Input
              className="row-cell"
              aria-label={`Answer ${i + 1}`}
              placeholder="Answer"
              {...register(`apply_answers.${i}.answer` as const)}
            />
            <button
              className="form-row__remove"
              type="button"
              aria-label={`Remove answer ${i + 1}`}
              onClick={() => remove(i)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {fields.length === 0 && (
        <p className="apply-answers__empty">No answers yet — add one below.</p>
      )}

      <div className="apply-answers__actions">
        <button
          className="form-row__add"
          type="button"
          onClick={() => append({ question: '', answer: '' })}
        >
          + Add answer
        </button>
        <button className="form-row__add" type="button" onClick={addCommonQuestions}>
          + Add common questions
        </button>
      </div>
    </section>
  );
}
