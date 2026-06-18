import { describe, expect, it } from 'vitest';
import { normalizeApplyAnswers } from '../apply-answers';

describe('normalizeApplyAnswers', () => {
  it('returns [] for null/undefined/non-object', () => {
    expect(normalizeApplyAnswers(undefined)).toEqual([]);
    expect(normalizeApplyAnswers(null)).toEqual([]);
    expect(normalizeApplyAnswers(42)).toEqual([]);
  });

  it('passes through an existing list, trimming and dropping both-empty rows', () => {
    const input = [
      { question: ' Gender / sex ', answer: ' Male ' },
      { question: '', answer: '' },
      { question: 'Q only', answer: '' },
    ];
    expect(normalizeApplyAnswers(input)).toEqual([
      { question: 'Gender / sex', answer: 'Male' },
      { question: 'Q only', answer: '' },
    ]);
  });

  it('maps legacy structured keys (table order) then additional_info lines', () => {
    const legacy = {
      work_authorization_us: 'Yes',
      visa_sponsorship_required: 'No',
      current_employer: 'Finturf',
      additional_info: 'Gender / sex: Male\nDisability: No, I do not have a disability',
    };
    expect(normalizeApplyAnswers(legacy)).toEqual([
      { question: 'Work authorization (US)', answer: 'Yes' },
      { question: 'Require visa sponsorship?', answer: 'No' },
      { question: 'Current employer', answer: 'Finturf' },
      { question: 'Gender / sex', answer: 'Male' },
      { question: 'Disability', answer: 'No, I do not have a disability' },
    ]);
  });

  it('splits additional_info on the FIRST colon; no-colon line → blank question', () => {
    const legacy = { additional_info: 'Note: a: b: c\njust a sentence' };
    expect(normalizeApplyAnswers(legacy)).toEqual([
      { question: 'Note', answer: 'a: b: c' },
      { question: '', answer: 'just a sentence' },
    ]);
  });

  it('skips empty/whitespace structured values and blank lines', () => {
    const legacy = { current_title: '   ', additional_info: '\n  \nTimezone: PT\n' };
    expect(normalizeApplyAnswers(legacy)).toEqual([{ question: 'Timezone', answer: 'PT' }]);
  });
});
