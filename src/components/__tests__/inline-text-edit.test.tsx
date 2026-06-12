import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mutate = vi.fn();
vi.mock('@/hooks/use-applications', () => ({ useUpdateReportField: () => ({ mutate }) }));

import { InlineTextEdit } from '../inline-text-edit';

describe('InlineTextEdit', () => {
  it('commits a changed value on Enter', () => {
    mutate.mockClear();
    render(<InlineTextEdit num={16} field="location" value="LA" ariaLabel="Edit location" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit location' }));
    const input = screen.getByRole('textbox', { name: 'Edit location' });
    fireEvent.change(input, { target: { value: 'Los Angeles' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mutate).toHaveBeenCalledWith({ num: 16, field: 'location', value: 'Los Angeles' });
  });
  it('does not persist when unchanged', () => {
    mutate.mockClear();
    render(<InlineTextEdit num={1} field="comp" value="$100K" ariaLabel="Edit comp" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit comp' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit comp' }), { key: 'Enter' });
    expect(mutate).not.toHaveBeenCalled();
  });
});
