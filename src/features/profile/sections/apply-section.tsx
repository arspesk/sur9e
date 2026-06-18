'use client';

// sections/apply-section.tsx — "Apply answers" Q&A row editor.
// Each row is one { question, answer } pair, persisted as one profile.yml list
// item. The schema preprocess (normalizeApplyAnswers) drops both-blank rows on
// save, so no trim logic is needed here.

import type { Control } from 'react-hook-form';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { Button, Input, Textarea } from '@/components/primitives';
import { COMMON_QUESTIONS } from '@/lib/schemas/apply-answers';
import type { ProfileFormValues } from '../schemas';

// react-hook-form's FieldArrayPath constraint requires the form values type
// to NOT carry an index signature (Zod's .passthrough() adds one). Cast to a
// plain structural type so useFieldArray can resolve 'apply_answers' as an
// ArrayPath and infer the correct element type.
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

      <div className="apply-answers">
        {fields.length === 0 ? (
          <p className="apply-answers__empty">No answers yet — add one below.</p>
        ) : (
          fields.map((field, i) => (
            <div className="apply-answers__row" key={field.id}>
              <Input
                aria-label={`Question ${i + 1}`}
                placeholder="Question (e.g. Work authorization (US))"
                {...register(`apply_answers.${i}.question` as const)}
              />
              <Textarea
                aria-label={`Answer ${i + 1}`}
                rows={1}
                placeholder="Answer (e.g. Yes)"
                {...register(`apply_answers.${i}.answer` as const)}
              />
              <Button
                type="button"
                variant="ghost"
                aria-label={`Remove answer ${i + 1}`}
                onClick={() => remove(i)}
              >
                ✕
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="apply-answers__actions">
        <Button
          type="button"
          variant="secondary"
          onClick={() => append({ question: '', answer: '' })}
        >
          + Add answer
        </Button>
        <Button type="button" variant="ghost" onClick={addCommonQuestions}>
          + Add common questions
        </Button>
      </div>
    </section>
  );
}
