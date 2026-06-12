import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mutate = vi.fn();
vi.mock('@/hooks/use-applications', () => ({ useUpdateReportField: () => ({ mutate }) }));

import { EnumPill } from '../enum-pill';

describe('EnumPill', () => {
  it('shows the value and opens the popover, persisting a pick', () => {
    mutate.mockClear();
    render(
      <EnumPill
        num={16}
        field="seniority"
        value="Mid"
        options={[
          { key: 'Mid', label: 'Mid' },
          { key: 'Senior', label: 'Senior' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Mid/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Senior' }));
    expect(mutate).toHaveBeenCalledWith({ num: 16, field: 'seniority', value: 'Senior' });
  });
  it('shows a placeholder when empty', () => {
    render(<EnumPill num={1} field="work_mode" value="" options={[]} placeholder="Set mode" />);
    expect(screen.getByRole('button', { name: /Set mode/ })).toBeInTheDocument();
  });
});
