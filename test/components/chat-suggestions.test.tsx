import { fireEvent, render, screen } from '@testing-library/react';
import { ArrowLeftRight, Clock, Mic, Sparkles } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import {
  buildSuggestionPool,
  ChatSuggestions,
  iconFor,
  pickSuggestions,
} from '@/features/chat/chat-suggestions';

// Grounded chips read the offers list; give it a fixed one.
vi.mock('@/hooks/use-applications', () => ({
  useApplications: () => ({
    data: {
      entries: [
        { num: 48, company: 'Attio', role: 'FE', status: 'interview', score: '4.2' },
        { num: 12, company: 'Linear', role: 'BE', status: 'screened', score: '3.9' },
        { num: 3, company: 'Vercel', role: 'PE', status: 'rejected', score: '3.1' },
      ],
    },
  }),
}));

describe('buildSuggestionPool', () => {
  it('grounds candidates in real companies, counts, and statuses', () => {
    const pool = buildSuggestionPool([
      { company: 'Attio', status: 'interview', score: 4.2 },
      { company: 'Linear', status: 'screened', score: 3.9 },
      { company: 'Vercel', status: 'rejected' },
    ]);
    expect(pool).toContain('Compare Attio and Linear');
    expect(pool).toContain('Which of my 3 offers is the strongest fit?');
    expect(pool).toContain('Prep me for the Attio interview');
    expect(pool).toContain('Why might I be getting screened out?');
    expect(pool).toContain('I have 1 waiting on me — what should I do next?');
    // top score names the highest-scored company
    expect(pool).toContain('Is Attio worth pursuing?');
  });

  it('counts screened and evaluated offers as waiting on the user', () => {
    const pool = buildSuggestionPool([
      { company: 'Acme', status: 'Screened', score: 3.8 },
      { company: 'Beta', status: 'Evaluated', score: 4.2 },
      { company: 'Gamma', status: 'Applied', score: 4.5 },
      { company: 'Delta', status: 'Interview', score: 3.6 },
    ]);

    expect(pool).toContain('I have 2 waiting on me — what should I do next?');
  });

  it('falls back to generic starters for an empty tracker', () => {
    expect(buildSuggestionPool([])).toEqual([
      'What should I focus on this week?',
      'What am I missing in my job search?',
      "How's my search going?",
    ]);
  });
});

describe('pickSuggestions', () => {
  it('returns up to n de-duplicated items from the pool', () => {
    const picked = pickSuggestions(['a', 'b', 'c', 'd', 'a'], 3, () => 0);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    for (const p of picked) expect(['a', 'b', 'c', 'd']).toContain(p);
  });

  it('never returns more than the pool holds', () => {
    expect(pickSuggestions(['only'], 3)).toEqual(['only']);
  });
});

describe('iconFor', () => {
  it('picks a contextual icon by the suggestion intent', () => {
    expect(iconFor('Compare Attio and Linear')).toBe(ArrowLeftRight);
    expect(iconFor('Prep me for the DocuWare interview')).toBe(Mic);
    expect(iconFor('What should I follow up on?')).toBe(Clock);
    expect(iconFor("How's my search going?")).toBe(Sparkles); // generic fallback
  });
});

describe('ChatSuggestions', () => {
  it('renders three chips and sends the clicked one verbatim', () => {
    const onPick = vi.fn();
    render(<ChatSuggestions onPick={onPick} />);
    const chips = screen.getAllByRole('button');
    expect(chips).toHaveLength(3);
    fireEvent.click(chips[0]);
    expect(onPick).toHaveBeenCalledWith(chips[0].textContent);
  });
});
