/**
 * test/components/modals.test.tsx
 *
 * Render-time parity tests for the 9 per-action modals (8 from the brief +
 * the screen URL-paste modal). Each test mounts the modal via the
 * useModalStore.open() entry point and asserts:
 *   - The modal renders (key BEM class is present in the DOM)
 *   - The visible title matches legacy copy for the given context
 *   - The primary CTA button is rendered with the legacy label
 *
 * We don't fire submit here — that path is covered by the useJobAction test
 * and the user's chrome MCP verification at the end of the task.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModalHost } from '@/components/modal-host';
import { useModalStore } from '@/stores/modal-store';

function renderModalHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModalHost />
    </QueryClientProvider>,
  );
}

async function openAndRender(
  name: Parameters<ReturnType<typeof useModalStore.getState>['open']>[0],
  context?: Record<string, unknown> | null,
) {
  let utils: ReturnType<typeof render> | undefined;
  await act(async () => {
    useModalStore.getState().open(name, context);
    utils = renderModalHost();
  });
  return utils!;
}

describe('per-action modals', () => {
  beforeEach(() => {
    useModalStore.setState({ modal: null, context: null });
  });

  afterEach(() => {
    useModalStore.setState({ modal: null, context: null });
  });

  it('apply-modal: shows CLI handoff with /sur9e apply <num>', async () => {
    await openAndRender('apply', { num: 42 });
    expect(screen.getByText('Apply in your terminal')).toBeTruthy();
    expect(screen.getByText('/sur9e apply 42')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeTruthy();
    // Two "Close" buttons render: the × close icon (aria-label) and the
    // secondary footer close button (text). Assert at least one is present.
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThanOrEqual(1);
  });

  it('followup-modal: shows CLI handoff with the canonical /sur9e follow-up <num>', async () => {
    await openAndRender('followup', { num: 7 });
    expect(screen.getByText('Follow up in your terminal')).toBeTruthy();
    expect(screen.getByText('/sur9e follow-up 7')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeTruthy();
  });

  it('cv-modal: titles include row num and renders Tailor CV CTA', async () => {
    await openAndRender('cv', { num: 9 });
    expect(screen.getByText('Tailor CV for #9?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tailor CV' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('cover-letter-modal: titles include row num and renders Generate CTA', async () => {
    await openAndRender('cover-letter', { num: 3 });
    expect(screen.getByText('Generate cover letter for #3?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeTruthy();
  });

  it('evaluate-modal: single-row title includes row num', async () => {
    await openAndRender('evaluate', { num: 11 });
    expect(screen.getByText('Run full evaluation for #11?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run evaluation' })).toBeTruthy();
  });

  it('evaluate-modal: batch title switches when count > 1', async () => {
    await openAndRender('evaluate', { count: 4, nums: [1, 2, 3, 4] });
    expect(screen.getByText('Run full evaluation for 4 offers?')).toBeTruthy();
  });

  it('interview-process-modal: titles include row num + Generate CTA', async () => {
    await openAndRender('interview-process', { num: 12 });
    expect(screen.getByText('Generate interview prep for #12?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate interview prep' })).toBeTruthy();
  });

  it('outreach-modal: titles include row num + Reach out CTA (matches the menu label)', async () => {
    await openAndRender('outreach', { num: 14 });
    expect(screen.getByText('Reach out for #14?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reach out' })).toBeTruthy();
  });

  it('research-modal: titles include row num + Run research CTA', async () => {
    await openAndRender('research', { num: 15 });
    expect(screen.getByText('Research #15?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run research' })).toBeTruthy();
  });

  it('screen-modal: URL input, depth radios (screen preselected), Add offer CTA', async () => {
    await openAndRender('screen');
    expect(screen.getByText('Add an offer')).toBeTruthy();
    expect(screen.getByLabelText('Job posting link')).toBeTruthy();
    const quick = screen.getByRole('radio', { name: /Quick screen/ }) as HTMLInputElement;
    const full = screen.getByRole('radio', { name: /Full evaluation/ }) as HTMLInputElement;
    expect(quick.checked).toBe(true);
    expect(full.checked).toBe(false);
    expect(screen.getByRole('button', { name: 'Add offer' })).toBeTruthy();
  });

  it('modal-host renders nothing when modal is null', () => {
    useModalStore.setState({ modal: null });
    const { container } = renderModalHost();
    expect(container.firstChild).toBeNull();
  });

  it('modal-host does not render delete modal (delegated to DeleteConfirmModal)', async () => {
    await act(async () => {
      useModalStore.getState().open('delete');
    });
    const { container } = renderModalHost();
    expect(container.firstChild).toBeNull();
  });
});
