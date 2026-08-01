import { describe, expect, it } from 'vitest';
import { planWorkflow } from '../planner';

describe('workflow planner', () => {
  it('expands screen-evaluate into two dependent jobs', () => {
    const plan = planWorkflow({
      targets: [{ num: 12 }],
      modes: ['screen-evaluate'],
      evaluatedOfferNums: new Set(),
    });

    expect(plan.steps.map(step => step.mode)).toEqual(['screen', 'evaluate']);
    expect(plan.steps[1]?.dependsOn).toEqual([plan.steps[0]?.id]);
  });

  it('inserts evaluation and serializes report writers before parallel artifacts', () => {
    const plan = planWorkflow({
      targets: [{ num: 12 }],
      modes: ['cover-letter', 'research', 'tailor-cv', 'reach-out'],
      evaluatedOfferNums: new Set(),
    });

    expect(plan.steps.map(step => step.mode)).toEqual([
      'evaluate',
      'research',
      'reach-out',
      'cover-letter',
      'tailor-cv',
    ]);
    const [evaluate, research, outreach, coverLetter, tailorCv] = plan.steps;
    expect(research?.dependsOn).toEqual([evaluate?.id]);
    expect(outreach?.dependsOn).toEqual([research?.id]);
    expect(coverLetter?.dependsOn).toEqual([outreach?.id]);
    expect(tailorCv?.dependsOn).toEqual([outreach?.id]);
  });

  it('does not regenerate evaluation when a valid one already exists', () => {
    const plan = planWorkflow({
      targets: [{ num: 12 }],
      modes: ['cover-letter', 'tailor-cv'],
      evaluatedOfferNums: new Set([12]),
    });

    expect(plan.steps.map(step => step.mode)).toEqual(['cover-letter', 'tailor-cv']);
    expect(plan.steps.every(step => step.dependsOn.length === 0)).toBe(true);
  });

  it('plans independent offer branches for selected bulk actions', () => {
    const plan = planWorkflow({
      targets: [{ num: 12 }, { num: 13 }],
      modes: ['evaluate', 'cover-letter'],
      evaluatedOfferNums: new Set(),
    });

    expect(plan.steps.map(step => [step.targetIndex, step.mode])).toEqual([
      [0, 'evaluate'],
      [0, 'cover-letter'],
      [1, 'evaluate'],
      [1, 'cover-letter'],
    ]);
    expect(plan.maxParallel).toBe(4);
  });

  it('inserts screening before offer modes for URL targets', () => {
    const plan = planWorkflow({
      targets: [{ url: 'https://example.com/jobs/1' }],
      modes: ['tailor-cv'],
      evaluatedOfferNums: new Set(),
    });

    expect(plan.steps.map(step => step.mode)).toEqual(['screen', 'evaluate', 'tailor-cv']);
    expect(plan.steps[1]?.dependsOn).toEqual([plan.steps[0]?.id]);
  });

  it('does not silently add screening to an explicit evaluate-only URL request', () => {
    expect(() =>
      planWorkflow({
        targets: [{ url: 'https://example.com/jobs/1' }],
        modes: ['evaluate'],
        evaluatedOfferNums: new Set(),
      }),
    ).toThrow(/import the job description.*tracked offer number/i);
  });

  it('maps process-queue to a queue screen system step', () => {
    const plan = planWorkflow({
      targets: [],
      modes: ['process-queue'],
      evaluatedOfferNums: new Set(),
    });

    expect(plan.steps).toMatchObject([{ mode: 'screen', params: { queue: true } }]);
  });

  it('canonicalizes aliases and removes duplicate requested modes', () => {
    const plan = planWorkflow({
      targets: [{ num: 12 }],
      modes: ['pdf', 'tailor-cv', 'contact', 'outreach'],
      evaluatedOfferNums: new Set([12]),
    });

    expect(plan.requestedModes).toEqual(['tailor-cv', 'reach-out']);
    expect(plan.steps.map(step => step.mode)).toEqual(['reach-out', 'tailor-cv']);
  });

  it.each(['scan', 'batch-evaluate'] as const)('plans %s as a singleton system workflow', mode => {
    const plan = planWorkflow({
      targets: [],
      modes: [mode],
      evaluatedOfferNums: new Set(),
    });

    expect(plan.steps).toEqual([
      expect.objectContaining({ targetIndex: null, mode, dependsOn: [] }),
    ]);
  });

  it('rejects mixed system and offer modes', () => {
    expect(() =>
      planWorkflow({
        targets: [{ num: 12 }],
        modes: ['scan', 'evaluate'],
        evaluatedOfferNums: new Set(),
      }),
    ).toThrow('system modes cannot be mixed');
  });

  it('rejects inline and handoff modes as background workflows', () => {
    expect(() =>
      planWorkflow({
        targets: [{ num: 12 }],
        modes: ['tracker'],
        evaluatedOfferNums: new Set(),
      }),
    ).toThrow('tracker runs inline');
    expect(() =>
      planWorkflow({
        targets: [{ num: 12 }],
        modes: ['apply'],
        evaluatedOfferNums: new Set(),
      }),
    ).toThrow('apply requires a handoff');
  });
});
