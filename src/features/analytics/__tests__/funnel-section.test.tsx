// Funnel must NOT show Screened as a stage (it's pre-pipeline); screened
// joins discarded in the side-note below the funnel, both deep-linked.

import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { FunnelSection } from '../funnel-section';

type Breakdown = ComponentProps<typeof FunnelSection>['breakdown'];

const BREAKDOWN = {
  screened: 12,
  evaluated: 8,
  applied: 5,
  responded: 3,
  interview: 2,
  offer: 1,
  rejected: 0,
  discarded: 34,
} as Breakdown;

describe('FunnelSection', () => {
  it('renders 5 funnel stages without screened', () => {
    const { container } = render(<FunnelSection breakdown={BREAKDOWN} totalOffers={65} />);
    expect(container.querySelectorAll('.funnel-row')).toHaveLength(5);
    expect(container.querySelector('[data-funnel-stage="screened"]')).toBeNull();
    expect(container.querySelector('[data-funnel-stage="evaluated"]')).not.toBeNull();
  });

  it('shows screened + discarded in the side-note with deep-links', () => {
    const { container } = render(<FunnelSection breakdown={BREAKDOWN} totalOffers={65} />);
    const note = container.querySelector('#funnelDiscarded');
    expect(note?.textContent).toContain('12');
    expect(note?.textContent).toContain('screened');
    expect(note?.textContent).toContain('34');
    expect(note?.textContent).toContain('discarded');
    const links = note
      ? Array.from(note.querySelectorAll('a')).map(a => a.getAttribute('href'))
      : [];
    expect(links).toContain('/offers?view=kanban#status=screened');
    expect(links).toContain('/offers?view=kanban#status=discarded');
  });

  it('omits a clause when its count is 0', () => {
    const { container } = render(
      <FunnelSection breakdown={{ ...BREAKDOWN, discarded: 0 } as Breakdown} totalOffers={31} />,
    );
    const note = container.querySelector('#funnelDiscarded');
    expect(note?.textContent).toContain('screened');
    expect(note?.textContent).not.toContain('discarded');
  });

  it('shows the quiet copy when both counts are 0', () => {
    render(
      <FunnelSection
        breakdown={{ ...BREAKDOWN, screened: 0, discarded: 0 } as Breakdown}
        totalOffers={19}
      />,
    );
    expect(screen.getByText('No offers screened or discarded this period.')).toBeTruthy();
  });
});
