// The row/card kebab must expose: open/copy links, status-gated Apply or
// Follow up, all 7 generator modes (no cost/time sub-labels), and Delete.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RowActionsMenu } from '../row-actions-menu';
import type { ApplicationRow } from '../table-types';

// Mock server actions — the component calls deleteApplicationAction via
// useDeleteApplication; we don't want real network/disk calls in unit tests.
vi.mock('@/server/actions/applications', () => ({
  deleteApplicationAction: vi.fn(),
  updateApplicationStatusAction: vi.fn(),
  updateReportFieldAction: vi.fn(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderMenu(row: Partial<ApplicationRow>) {
  const anchorRef = createRef<HTMLButtonElement>();
  return render(
    <RowActionsMenu
      open
      anchorRef={anchorRef}
      row={{ num: 16, company: 'Acme', role: 'SE', status: 'Screened', ...row } as ApplicationRow}
      onClose={() => {}}
    />,
    { wrapper },
  );
}

describe('RowActionsMenu', () => {
  it('shows all 7 generator modes regardless of status', () => {
    renderMenu({ status: 'Applied' });
    for (const label of [
      'Evaluate',
      'Tailor CV',
      'Cover letter',
      'Company research',
      'Reach out',
      'Interview prep',
      'Negotiate',
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeTruthy();
    }
  });

  it('shows Apply for screened, Follow up for applied', () => {
    renderMenu({ status: 'Screened' });
    expect(screen.getByRole('menuitem', { name: 'Apply' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Follow up' })).toBeNull();
  });

  it('has link items, delete, and no cost/time sub-labels', () => {
    renderMenu({ url: 'https://example.com/job' });
    expect(screen.getByRole('menuitem', { name: 'Open job posting' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy share link' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete offer' })).toBeTruthy();
    expect(screen.queryByText(/\$0\.50/)).toBeNull();
  });

  it('exposes a keyboard-reachable Change status item', () => {
    renderMenu({ status: 'Applied' });
    expect(screen.getByRole('menuitem', { name: 'Change status' })).toBeTruthy();
  });

  it('disables Open job posting when the row has no URL', () => {
    renderMenu({ url: undefined });
    const item = screen.getByRole('menuitem', { name: 'Open job posting' });
    expect((item as HTMLButtonElement).disabled).toBe(true);
  });
});
