// components/modals/__tests__/scan-confirm-modal.test.tsx
//
// 2026-06-10 audit: the Add-menu scan actions used to spend tokens on a
// single unconfirmed menu click. Contract under test:
//   1. Both scan kinds render a confirm dialog with Time / Result, Time
//      derived from JOB_TYPES estimateS (no hardcoded promises).
//   2. Cancel fires onCancel and never onConfirm.
//   3. The primary button fires onConfirm exactly once.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobEstimateLabel } from '@/lib/job-types';
import { ScanConfirmModal } from '../scan-confirm-modal';

describe('ScanConfirmModal', () => {
  it('renders an estimateS-derived time and result for scan', () => {
    render(<ScanConfirmModal jobType="scan" onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText('Run scan with screening?')).toBeInTheDocument();
    // Time line comes from the same estimateS that paces the progress card.
    expect(screen.getByText(new RegExp(jobEstimateLabel('scan')))).toBeInTheDocument();
    expect(screen.getByText('Result:')).toBeInTheDocument();
  });

  it('renders an estimateS-derived time for batch-evaluate', () => {
    render(<ScanConfirmModal jobType="batch-evaluate" onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText('Run scan with evaluation?')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(jobEstimateLabel('batch-evaluate')))).toBeInTheDocument();
  });

  it('Cancel fires onCancel and never onConfirm', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ScanConfirmModal jobType="scan" onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('the primary button fires onConfirm exactly once', () => {
    const onConfirm = vi.fn();
    render(<ScanConfirmModal jobType="batch-evaluate" onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start scan' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
