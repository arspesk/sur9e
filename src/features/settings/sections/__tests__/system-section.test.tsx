import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeleteConfirmStore } from '@/components/delete-confirm-modal';
import { useToastStore } from '@/components/toast/toast-store';
import { FetchJsonError } from '@/lib/api/fetch-json';
import type { UpdateJob } from '@/lib/schemas/update-job';
import type { SettingsFormValues } from '../../types';
import { SystemSection } from '../system-section';

const JOB_ID = '26cf6d7a-2763-4b9d-b539-930fa8414bd5';
const RETURN_HREF_KEY = 'sur9e.update.return-href';
const ACTIVE_JOB_KEY = 'sur9e.update.active-job';
const RESULT_NOTICE_KEY = 'sur9e.update.result';

const mocks = vi.hoisted(() => ({
  version: { isPending: false, data: { version: '0.3.2' } } as Record<string, unknown>,
  check: {
    isPending: false,
    mutateAsync: vi.fn(),
  } as Record<string, unknown>,
  apply: {
    isPending: false,
    mutateAsync: vi.fn(),
  } as Record<string, unknown>,
  job: {
    data: undefined,
    isError: false,
    error: null,
  } as Record<string, unknown>,
  active: {
    data: undefined,
    isError: false,
    error: null,
  } as Record<string, unknown>,
  rollback: {
    isPending: false,
    mutateAsync: vi.fn(),
  } as Record<string, unknown>,
  requestedJobIds: [] as Array<string | null | undefined>,
  activeEnabled: [] as boolean[],
}));

vi.mock('@/hooks/use-system', () => ({
  useVersion: () => mocks.version,
  useUpdateCheck: () => mocks.check,
  useUpdateApply: () => mocks.apply,
  useActiveUpdateJob: (enabled: boolean) => {
    mocks.activeEnabled.push(enabled);
    return mocks.active;
  },
  useUpdateJob: (jobId: string | null | undefined) => {
    mocks.requestedJobIds.push(jobId);
    return jobId ? mocks.job : { data: undefined, isError: false, error: null };
  },
  useRollback: () => mocks.rollback,
}));

function makeJob(overrides: Partial<UpdateJob> = {}): UpdateJob {
  return {
    id: JOB_ID,
    phase: 'queued',
    launchState: 'claim-pending',
    mode: { prod: false, tailscale: false },
    fromVersion: '0.3.2',
    toVersion: '0.4.0',
    createdAt: '2026-07-31T20:00:00.000Z',
    updatedAt: '2026-07-31T20:00:00.000Z',
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const methods = useForm<SettingsFormValues>({
    defaultValues: {
      system: {
        update_source: 'https://github.com/arspesk/sur9e.git',
        update_branch: 'main',
      },
    } as SettingsFormValues,
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
}

function renderSection(props: { navigate?: (href: string) => void } = {}) {
  return render(<SystemSection {...props} />, { wrapper: Wrapper });
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/settings');
  useToastStore.setState({ toasts: [] });
  useDeleteConfirmStore.setState({ visible: false, options: {}, _resolve: null });
  mocks.version = { isPending: false, data: { version: '0.3.2' } };
  mocks.check = { isPending: false, mutateAsync: vi.fn() };
  mocks.apply = { isPending: false, mutateAsync: vi.fn() };
  mocks.job = { data: undefined, isError: false, error: null };
  mocks.active = { data: undefined, isError: false, error: null };
  mocks.rollback = { isPending: false, mutateAsync: vi.fn() };
  mocks.requestedJobIds = [];
  mocks.activeEnabled = [];
  Object.assign(window, {
    deleteConfirmModal: { confirm: vi.fn(async () => true) },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SystemSection update status', () => {
  it('checks automatically when Settings mounts', async () => {
    const check = vi.fn().mockResolvedValue({
      status: 'update-available',
      local: '0.3.2',
      remote: '0.4.0',
      changelog: 'Faster restart. Improved update recovery.',
    });
    mocks.check = { isPending: false, mutateAsync: check };
    mocks.active = { data: { job: null }, isError: false, error: null };

    renderSection();

    expect(await screen.findByText('v0.4.0 available')).toBeTruthy();
    expect(check).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Update now' })).toBeTruthy();
  });

  it('keeps an automatic check failure inline without showing a toast', async () => {
    mocks.check = {
      isPending: false,
      mutateAsync: vi.fn().mockRejectedValue(new Error('update service unavailable')),
    };
    mocks.active = { data: { job: null }, isError: false, error: null };

    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('update service unavailable');
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('still toasts when a manual retry fails', async () => {
    mocks.check = {
      isPending: false,
      mutateAsync: vi.fn().mockRejectedValue(new Error('update service unavailable')),
    };
    mocks.active = { data: { job: null }, isError: false, error: null };
    renderSection();
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({
          tone: 'danger',
          message: expect.stringContaining('update service unavailable'),
        }),
      ]),
    );
  });

  it('discovers and attaches the latest durable job when this tab has no retained id', async () => {
    window.history.replaceState({}, '', '/settings?view=system#system');
    mocks.active = {
      data: { job: makeJob({ phase: 'recovery-queued' }) },
      isError: false,
      error: null,
    };
    mocks.job = {
      data: makeJob({ phase: 'recovery-queued' }),
      isError: false,
      error: null,
    };

    renderSection();

    await waitFor(() => expect(window.sessionStorage.getItem(ACTIVE_JOB_KEY)).toBe(JOB_ID));
    expect(window.sessionStorage.getItem(RETURN_HREF_KEY)).toBe(
      'http://localhost:3000/settings?view=system#system',
    );
    expect(mocks.activeEnabled).toContain(true);
    expect(mocks.activeEnabled.at(-1)).toBe(false);
    expect(mocks.requestedJobIds).toContain(JOB_ID);
    expect(mocks.check.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Preparing recovery');
  });

  it('does not run discovery when sessionStorage already retains a job id', () => {
    window.sessionStorage.setItem(ACTIVE_JOB_KEY, JOB_ID);
    mocks.job = { data: makeJob(), isError: false, error: null };

    renderSection();

    expect(mocks.activeEnabled.length).toBeGreaterThan(0);
    expect(mocks.activeEnabled.every(enabled => !enabled)).toBe(true);
    expect(mocks.check.mutateAsync).not.toHaveBeenCalled();
  });

  it('discards a corrupt retained job id instead of trapping the controls', () => {
    window.sessionStorage.setItem(ACTIVE_JOB_KEY, 'not-a-job-id');
    renderSection();

    expect(window.sessionStorage.getItem(ACTIVE_JOB_KEY)).toBeNull();
    expect(screen.getByText('Not checked yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
  });

  it('starts neutral and gates Update now behind an available check result', async () => {
    const check = vi.fn().mockResolvedValue({
      status: 'update-available',
      local: '0.3.2',
      remote: '0.4.0',
      changelog: 'Faster restart. Improved update recovery.',
    });
    mocks.check = { isPending: false, mutateAsync: check };
    renderSection();

    expect(screen.getByRole('heading', { name: 'Updates & about' })).toBeTruthy();
    expect(screen.getByText('Keep Sur9e current without losing your place.')).toBeTruthy();
    expect(screen.getByText('Installed version')).toBeTruthy();
    expect(screen.getByText('v0.3.2')).toBeTruthy();
    expect(screen.getByText('Not checked yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(await screen.findByText('v0.4.0 available')).toBeTruthy();
    expect(screen.getByText('Faster restart. Improved update recovery.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('uses the shared medium Settings button size for update actions', () => {
    renderSection();

    for (const name of ['Check for updates', 'Edit update source', 'Roll back']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('btn-md');
      expect(button).not.toHaveClass('btn-lg');
    }
  });

  it('shows checking and up-to-date states with one clear action', async () => {
    let resolveCheck: ((value: unknown) => void) | undefined;
    const pendingCheck = new Promise(resolve => {
      resolveCheck = resolve;
    });
    mocks.check = { isPending: false, mutateAsync: vi.fn(() => pendingCheck) };
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(screen.getByText('Checking for updates…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();

    resolveCheck?.({ status: 'up-to-date', local: '0.3.2', remote: '0.3.2' });
    expect(await screen.findByText('Up to date')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();
  });

  it('expands the existing RHF source fields from the compact summary', () => {
    renderSection();

    expect(screen.getByText('https://github.com/arspesk/sur9e.git')).toBeTruthy();
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.queryByLabelText('Update source')).toBeNull();
    expect(screen.queryByLabelText('Update branch')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit update source' }));

    expect(screen.getByLabelText('Update source')).toHaveValue(
      'https://github.com/arspesk/sur9e.git',
    );
    expect(screen.getByLabelText('Update branch')).toHaveValue('main');
  });

  it('keeps failures visible with recovery guidance and accessible status', async () => {
    mocks.check = {
      isPending: false,
      mutateAsync: vi.fn().mockRejectedValue(new Error('update service unavailable')),
    };
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('update service unavailable');
    expect(alert).toHaveTextContent('Try checking again');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });
});

describe('SystemSection applying and returning', () => {
  it('confirms versions, downtime, and protected data before starting an update', async () => {
    const confirm = vi.fn(async () => false);
    Object.assign(window, { deleteConfirmModal: { confirm } });
    mocks.check = {
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({
        status: 'update-available',
        local: '0.3.2',
        remote: '0.4.0',
        changelog: 'Faster restart.',
      }),
    };
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }));

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('v0.3.2'),
        target: expect.stringContaining('v0.3.2 → v0.4.0'),
        bodyText: expect.stringMatching(/briefly.*offline/i),
        warningText: expect.stringMatching(/CV.*profile.*tracker.*reports.*untouched/i),
        confirmLabel: 'Update now',
      }),
    );
    expect(mocks.apply.mutateAsync).not.toHaveBeenCalled();
  });

  it('opens the mounted shared confirmation modal when no legacy window bridge exists', async () => {
    delete (window as typeof window & { deleteConfirmModal?: unknown }).deleteConfirmModal;
    mocks.check = {
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({
        status: 'update-available',
        local: '0.3.2',
        remote: '0.4.0',
        changelog: 'Faster restart.',
      }),
    };
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }));

    expect(useDeleteConfirmStore.getState()).toMatchObject({
      visible: true,
      options: {
        title: 'Update Sur9e from v0.3.2 to v0.4.0?',
        confirmLabel: 'Update now',
      },
    });
    useDeleteConfirmStore.getState()._settle(false);
  });

  it('stores the exact href and job id, then announces durable progress', async () => {
    window.history.replaceState({}, '', '/settings?view=system#system');
    mocks.check = {
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({
        status: 'update-available',
        local: '0.3.2',
        remote: '0.4.0',
        changelog: '',
      }),
    };
    mocks.apply = {
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({ jobId: JOB_ID }),
    };
    const view = renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }));

    await waitFor(() =>
      expect(mocks.apply.mutateAsync).toHaveBeenCalledWith({ toVersion: '0.4.0' }),
    );
    expect(window.sessionStorage.getItem(RETURN_HREF_KEY)).toBe(
      'http://localhost:3000/settings?view=system#system',
    );
    expect(window.sessionStorage.getItem(ACTIVE_JOB_KEY)).toBe(JOB_ID);
    expect(mocks.requestedJobIds).toContain(JOB_ID);

    mocks.job = {
      data: makeJob({
        phase: 'rebuilding',
        launchState: 'owned',
        pid: 4242,
      }),
      isError: false,
      error: null,
    };
    view.rerender(<SystemSection />);

    expect(screen.getByRole('status')).toHaveTextContent('Rebuilding');
    expect(screen.getByRole('button', { name: 'Rebuilding' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled();
  });

  it('shows a failed terminal job with its phase and manual recovery guidance', () => {
    window.sessionStorage.setItem(ACTIVE_JOB_KEY, JOB_ID);
    mocks.job = {
      data: makeJob({ phase: 'failed', error: 'Restart verification timed out' }),
      isError: false,
      error: null,
    };
    renderSection();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Update failed');
    expect(alert).toHaveTextContent('Restart verification timed out');
    expect(alert).toHaveTextContent('Roll back');
  });

  it('releases a failed retained job so a fresh check can retry after reload', async () => {
    window.sessionStorage.setItem(ACTIVE_JOB_KEY, JOB_ID);
    mocks.job = {
      data: makeJob({ phase: 'failed', error: 'Restart verification timed out' }),
      isError: false,
      error: null,
    };
    mocks.check = {
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({
        status: 'update-available',
        local: '0.3.2',
        remote: '0.4.0',
        changelog: 'Retry the update safely.',
      }),
    };
    renderSection();

    expect(screen.getByRole('alert')).toHaveTextContent('Restart verification timed out');
    await waitFor(() => expect(window.sessionStorage.getItem(ACTIVE_JOB_KEY)).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(await screen.findByRole('button', { name: 'Update now' })).toBeEnabled();
  });

  it('keeps the last durable phase visible through expected restart downtime', () => {
    window.sessionStorage.setItem(ACTIVE_JOB_KEY, JOB_ID);
    mocks.job = {
      data: makeJob({
        phase: 'restarting',
        launchState: 'owned',
        pid: 4242,
      }),
      isError: true,
      error: new TypeError('Failed to fetch'),
    };
    renderSection();

    expect(screen.getByRole('status')).toHaveTextContent('Restarting');
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Restarting' })).toBeDisabled();
  });

  it('releases missing retained progress so controls stop polling and become usable', async () => {
    window.sessionStorage.setItem(ACTIVE_JOB_KEY, JOB_ID);
    window.sessionStorage.setItem(RETURN_HREF_KEY, 'http://localhost:3000/settings');
    mocks.job = {
      data: undefined,
      isError: true,
      error: new FetchJsonError(404, 'Update job not found'),
    };

    renderSection();

    await waitFor(() => expect(window.sessionStorage.getItem(ACTIVE_JOB_KEY)).toBeNull());
    expect(window.sessionStorage.getItem(RETURN_HREF_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    expect(screen.queryByText('Starting update…')).toBeNull();
    expect(mocks.activeEnabled.at(-1)).toBe(false);
  });

  it.each([
    ['succeeded', 'succeeded'],
    ['rolled-back', 'rolled-back'],
  ] as const)('stores a one-load %s result and restores the exact saved URL', (phase, kind) => {
    const exactHref = 'http://localhost:3000/settings?view=system#system';
    const navigate = vi.fn();
    window.sessionStorage.setItem(RETURN_HREF_KEY, exactHref);
    window.sessionStorage.setItem(ACTIVE_JOB_KEY, JOB_ID);
    mocks.job = {
      data: makeJob({
        phase,
        ...(phase === 'rolled-back' ? { error: 'Updated build did not become ready' } : {}),
      }),
      isError: false,
      error: null,
    };

    renderSection({ navigate });

    expect(window.sessionStorage.getItem(ACTIVE_JOB_KEY)).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem(RESULT_NOTICE_KEY) ?? '{}')).toMatchObject({
      kind,
      version: phase === 'succeeded' ? '0.4.0' : '0.3.2',
    });
    expect(navigate).toHaveBeenCalledWith(exactHref);
  });

  it('uses shared confirmation for manual rollback and disables it while pending', async () => {
    const confirm = vi.fn(async () => true);
    Object.assign(window, { deleteConfirmModal: { confirm } });
    mocks.rollback = {
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
    };
    const first = renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));

    await waitFor(() => expect(mocks.rollback.mutateAsync).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Roll back' }));
    first.unmount();

    mocks.rollback = { isPending: true, mutateAsync: vi.fn() };
    renderSection();
    expect(screen.getByRole('button', { name: 'Roll back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit update source' })).toBeDisabled();
  });

  it('consumes success and automatic rollback notices exactly once', () => {
    window.sessionStorage.setItem(
      RESULT_NOTICE_KEY,
      JSON.stringify({ kind: 'succeeded', version: '0.4.0' }),
    );
    const first = renderSection();

    expect(window.sessionStorage.getItem(RESULT_NOTICE_KEY)).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      tone: 'success',
      message: expect.stringMatching(/updated to v0\.4\.0/i),
    });
    expect(first.getByRole('status')).toHaveTextContent('Update complete');
    first.unmount();

    renderSection();
    expect(useToastStore.getState().toasts).toHaveLength(1);

    window.sessionStorage.setItem(
      RESULT_NOTICE_KEY,
      JSON.stringify({ kind: 'rolled-back', version: '0.3.2', error: 'Build failed' }),
    );
    const recovered = renderSection();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      tone: 'warning',
      message: expect.stringMatching(/automatically recovered.*v0\.3\.2/i),
    });
    expect(recovered.container.querySelector('[role="status"]')).toHaveTextContent(
      'Recovered automatically',
    );
  });
});
