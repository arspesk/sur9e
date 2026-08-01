// Single source of truth for per-offer status-pick rules. Every surface that
// changes one offer's status (board drag, board-card / report-hero / drawer
// status pill via StatusPopoverHost, table status pill) must apply the SAME
// transitions: → evaluated opens the evaluate confirm modal (which PATCHes
// and spawns the eval job); everything else — including evaluated →
// screened (the report keeps its evaluated depth; maintainer decision
// 2026-06-11) — proceeds as a plain status PATCH.
import { describe, expect, it } from 'vitest';
import { followupForStatusTransition, interceptStatusPick } from '@/lib/status-transitions';

describe('interceptStatusPick', () => {
  it('screened → evaluated routes to the evaluate confirm modal', () => {
    expect(interceptStatusPick('Screened', 'evaluated')).toEqual({ kind: 'evaluate-modal' });
  });

  it('any non-evaluated status → evaluated routes to the modal too', () => {
    expect(interceptStatusPick('discarded', 'evaluated')).toEqual({ kind: 'evaluate-modal' });
    expect(interceptStatusPick('applied', 'evaluated')).toEqual({ kind: 'evaluate-modal' });
  });

  it('evaluated → screened proceeds — the evaluation report stays intact', () => {
    expect(interceptStatusPick('Evaluated', 'screened')).toEqual({ kind: 'proceed' });
  });

  it('same status is a no-op proceed; ordinary transitions proceed', () => {
    expect(interceptStatusPick('evaluated', 'evaluated')).toEqual({ kind: 'proceed' });
    expect(interceptStatusPick('screened', 'discarded')).toEqual({ kind: 'proceed' });
    expect(interceptStatusPick('evaluated', 'applied')).toEqual({ kind: 'proceed' });
    expect(interceptStatusPick('discarded', 'screened')).toEqual({ kind: 'proceed' }); // recovery stays allowed
  });

  it('handles missing/title-cased input defensively', () => {
    expect(interceptStatusPick(undefined, 'evaluated')).toEqual({ kind: 'evaluate-modal' });
    expect(interceptStatusPick('', 'applied')).toEqual({ kind: 'proceed' });
  });
});

describe('followupForStatusTransition', () => {
  it('maps a transition to interview to interview preparation', () => {
    expect(followupForStatusTransition(1001, 'applied', 'interview')).toEqual({
      num: 1001,
      jobKind: 'interview-prep',
    });
  });

  it('maps a transition to offer to negotiation', () => {
    expect(followupForStatusTransition(1001, 'interview', 'offer')).toEqual({
      num: 1001,
      jobKind: 'negotiate',
    });
  });

  it('returns null when interview or offer is already the current status', () => {
    expect(followupForStatusTransition(1001, 'interview', 'interview')).toBeNull();
    expect(followupForStatusTransition(1001, 'offer', 'offer')).toBeNull();
  });

  it('treats legacy bold Interview as the same canonical status', () => {
    expect(followupForStatusTransition(1001, '**Interview**', 'interview')).toBeNull();
  });

  it('treats legacy bold Offer as the same canonical status', () => {
    expect(followupForStatusTransition(1001, '**Offer**', 'offer')).toBeNull();
  });

  it('returns null for unrelated transitions', () => {
    expect(followupForStatusTransition(1001, 'screened', 'applied')).toBeNull();
  });

  it('normalizes title-cased and whitespace-padded statuses defensively', () => {
    expect(followupForStatusTransition(1001, ' Applied ', ' Interview ')).toEqual({
      num: 1001,
      jobKind: 'interview-prep',
    });
    expect(followupForStatusTransition(1001, ' Interview ', ' Offer ')).toEqual({
      num: 1001,
      jobKind: 'negotiate',
    });
    expect(followupForStatusTransition(1001, ' Offer ', ' offer ')).toBeNull();
  });
});
