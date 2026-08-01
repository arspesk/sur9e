'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useDeleteConfirmStore } from '@/components/delete-confirm-modal';
import { Button, HelperText, Input, Label } from '@/components/primitives';
import { useToastStore } from '@/components/toast/toast-store';
import {
  type UpdateCheckResponse,
  useRollback,
  useUpdateApply,
  useUpdateCheck,
  useUpdateJob,
  useVersion,
} from '@/hooks/use-system';
import type { UpdateJob, UpdateJobPhase } from '@/lib/schemas/update-job';
import type { SettingsFormValues } from '../types';

const RETURN_HREF_KEY = 'sur9e.update.return-href';
const ACTIVE_JOB_KEY = 'sur9e.update.active-job';
const RESULT_NOTICE_KEY = 'sur9e.update.result';
const UPDATE_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TERMINAL_PHASES = new Set<UpdateJobPhase>(['succeeded', 'rolled-back', 'failed']);

const PHASE_LABEL: Record<UpdateJobPhase, string> = {
  queued: 'Starting update…',
  applying: 'Updating files',
  stopping: 'Preparing to restart',
  rebuilding: 'Rebuilding',
  restarting: 'Restarting',
  verifying: 'Verifying restart',
  recovering: 'Recovering previous version',
  succeeded: 'Update complete',
  'rolled-back': 'Recovered automatically',
  failed: 'Update failed',
};

interface ResultNotice {
  kind: 'succeeded' | 'rolled-back';
  version: string;
  error?: string;
}

interface ConfirmOptions {
  title: string;
  target: string;
  bodyText: string;
  warningText: string;
  confirmLabel: string;
}

interface SystemSectionProps {
  navigate?: (href: string) => void;
}

function defaultNavigate(href: string) {
  if (href === window.location.href) {
    window.location.reload();
    return;
  }
  window.location.replace(href);
}

function getConfirmation(): ((options: ConfirmOptions) => Promise<boolean>) | undefined {
  return (
    (
      window as typeof window & {
        deleteConfirmModal?: { confirm: (options: ConfirmOptions) => Promise<boolean> };
      }
    ).deleteConfirmModal?.confirm ?? useDeleteConfirmStore.getState().confirm
  );
}

function changelogExcerpt(changelog: string) {
  const normalized = changelog.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177).trimEnd()}…`;
}

function readActiveJobId() {
  if (typeof window === 'undefined') return null;
  const jobId = window.sessionStorage.getItem(ACTIVE_JOB_KEY);
  if (!jobId || UPDATE_JOB_ID.test(jobId)) return jobId;
  window.sessionStorage.removeItem(ACTIVE_JOB_KEY);
  return null;
}

function readResultNotice(): ResultNotice | null {
  const raw = window.sessionStorage.getItem(RESULT_NOTICE_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(RESULT_NOTICE_KEY);
  try {
    const parsed = JSON.parse(raw) as Partial<ResultNotice>;
    if (
      (parsed.kind === 'succeeded' || parsed.kind === 'rolled-back') &&
      typeof parsed.version === 'string'
    ) {
      return parsed as ResultNotice;
    }
  } catch {
    // Invalid one-load notices are discarded above so they cannot toast forever.
  }
  return null;
}

function resultFromJob(job: UpdateJob): ResultNotice | null {
  if (job.phase === 'succeeded') {
    return { kind: 'succeeded', version: job.toVersion ?? job.fromVersion };
  }
  if (job.phase === 'rolled-back') {
    return { kind: 'rolled-back', version: job.fromVersion, error: job.error };
  }
  return null;
}

export function SystemSection({ navigate = defaultNavigate }: SystemSectionProps = {}) {
  const { register, control } = useFormContext<SettingsFormValues>();
  const source = useWatch({ control, name: 'system.update_source' }) ?? '?';
  const branch = useWatch({ control, name: 'system.update_branch' }) ?? '?';
  const pushToast = useToastStore(state => state.push);
  const [editingSource, setEditingSource] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResponse | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [jobId, setJobId] = useState<string | null>(readActiveJobId);
  const [resultNotice, setResultNotice] = useState<ResultNotice | null>(null);

  const versionQuery = useVersion();
  const installedVersion = versionQuery.isPending ? '…' : (versionQuery.data?.version ?? '?');
  const updateCheck = useUpdateCheck();
  const updateApply = useUpdateApply();
  const updateJob = useUpdateJob(jobId);
  const rollbackMutation = useRollback();
  const job = updateJob.data;
  const jobRunning = Boolean(jobId && (!job || !TERMINAL_PHASES.has(job.phase)));
  const actionsPending =
    isChecking ||
    isApplying ||
    jobRunning ||
    updateCheck.isPending ||
    updateApply.isPending ||
    rollbackMutation.isPending;

  useEffect(() => {
    const notice = readResultNotice();
    if (!notice) return;
    setResultNotice(notice);
    if (notice.kind === 'succeeded') {
      pushToast('success', `Sur9e updated to v${notice.version}.`);
    } else {
      pushToast(
        'warning',
        `Sur9e automatically recovered v${notice.version} after the update failed.`,
      );
    }
  }, [pushToast]);

  useEffect(() => {
    if (!job) return;
    if (job.phase === 'failed') {
      window.sessionStorage.removeItem(ACTIVE_JOB_KEY);
      window.sessionStorage.removeItem(RETURN_HREF_KEY);
      return;
    }
    const notice = resultFromJob(job);
    if (!notice) return;

    const href = window.sessionStorage.getItem(RETURN_HREF_KEY) ?? window.location.href;
    window.sessionStorage.setItem(RESULT_NOTICE_KEY, JSON.stringify(notice));
    window.sessionStorage.removeItem(ACTIVE_JOB_KEY);
    window.sessionStorage.removeItem(RETURN_HREF_KEY);
    setResultNotice(notice);
    setJobId(null);
    navigate(href);
  }, [job, navigate]);

  const checkUpdates = useCallback(async () => {
    if (job?.phase === 'failed') setJobId(null);
    setIsChecking(true);
    setCheckError(null);
    try {
      const result = await updateCheck.mutateAsync();
      setCheckResult(result);
      if (result.status === 'offline') {
        setCheckError('Could not reach the update service. Try checking again.');
      } else if (result.status === 'dismissed') {
        setCheckError('The update check was dismissed. Try checking again when you are ready.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCheckError(`Update check failed: ${message}. Try checking again.`);
      pushToast('danger', `Update check failed (${message}) — try again later.`);
    } finally {
      setIsChecking(false);
    }
  }, [job?.phase, pushToast, updateCheck]);

  const applyUpdate = useCallback(async () => {
    if (checkResult?.status !== 'update-available') return;
    const fromVersion = checkResult.local;
    const toVersion = checkResult.remote;
    const confirm = getConfirmation();
    const ok = confirm
      ? await confirm({
          title: `Update Sur9e from v${fromVersion} to v${toVersion}?`,
          target: `v${fromVersion} → v${toVersion}`,
          bodyText: 'Sur9e will briefly go offline while it updates and restarts in this tab.',
          warningText: 'Your CV, profile, tracker, and reports are untouched.',
          confirmLabel: 'Update now',
        })
      : window.confirm(
          `Update Sur9e from v${fromVersion} to v${toVersion}?\n\nSur9e will briefly go offline while it updates and restarts. Your CV, profile, tracker, and reports are untouched.`,
        );
    if (!ok) return;

    setIsApplying(true);
    setCheckError(null);
    window.sessionStorage.setItem(RETURN_HREF_KEY, window.location.href);
    try {
      const result = await updateApply.mutateAsync({ toVersion });
      window.sessionStorage.setItem(ACTIVE_JOB_KEY, result.jobId);
      setJobId(result.jobId);
    } catch (error) {
      window.sessionStorage.removeItem(RETURN_HREF_KEY);
      const message = error instanceof Error ? error.message : String(error);
      setCheckError(`Update could not start: ${message}. Try again or use Roll back for recovery.`);
      pushToast('danger', `Update could not start (${message}).`);
    } finally {
      setIsApplying(false);
    }
  }, [checkResult, pushToast, updateApply]);

  const rollback = useCallback(async () => {
    const confirm = getConfirmation();
    const ok = confirm
      ? await confirm({
          title: 'Roll back to the previous version?',
          target: 'sur9e installation',
          bodyText:
            'Replaces the current install with the previous version. Your data (CV, profile, tracker, reports) is not touched.',
          warningText: 'Active background jobs may need to be re-run.',
          confirmLabel: 'Roll back',
        })
      : window.confirm(
          'Roll back Sur9e to the previous installed version?\nYour data (CV, profile, tracker, reports) will not be touched.',
        );
    if (!ok) return;
    try {
      const result = await rollbackMutation.mutateAsync();
      pushToast(
        result?.ok ? 'success' : 'danger',
        result?.ok
          ? 'Rolled back to the previous version.'
          : `Rollback failed (${result?.error || 'unknown'}) — see logs.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast('danger', `Rollback failed (${message}) — see logs.`);
    }
  }, [pushToast, rollbackMutation]);

  const status = useMemo(() => {
    if (resultNotice?.kind === 'rolled-back') {
      return {
        tone: 'recovered',
        badge: 'Recovered automatically',
        detail: `The previous version (v${resultNotice.version}) is running.`,
      } as const;
    }
    if (resultNotice?.kind === 'succeeded') {
      return {
        tone: 'success',
        badge: 'Update complete',
        detail: `Sur9e is now running v${resultNotice.version}.`,
      } as const;
    }
    if (job?.phase === 'failed') {
      return {
        tone: 'danger',
        badge: 'Update failed',
        detail: job.error ?? 'The update did not complete.',
      } as const;
    }
    if (jobRunning) {
      const phase = job?.phase;
      return {
        tone: phase === 'recovering' ? 'recovered' : 'updating',
        badge: phase ? PHASE_LABEL[phase] : 'Starting update…',
        detail: updateJob.isError
          ? 'The server is restarting. Reconnecting to retained update progress…'
          : 'Keep this tab open. Sur9e will return here when it is ready.',
      } as const;
    }
    if (isChecking) {
      return {
        tone: 'checking',
        badge: 'Checking for updates…',
        detail: 'Comparing your installed version with the configured update source.',
      } as const;
    }
    if (checkError) {
      return { tone: 'danger', badge: 'Check failed', detail: checkError } as const;
    }
    if (checkResult?.status === 'up-to-date') {
      return {
        tone: 'success',
        badge: 'Up to date',
        detail: `v${checkResult.local} is the latest available version.`,
      } as const;
    }
    if (checkResult?.status === 'update-available') {
      return {
        tone: 'available',
        badge: `v${checkResult.remote} available`,
        detail: `Ready to update from v${checkResult.local}.`,
      } as const;
    }
    return {
      tone: 'neutral',
      badge: 'Not checked yet',
      detail: 'Check when you are ready. Updates never run automatically.',
    } as const;
  }, [checkError, checkResult, isChecking, job, jobRunning, resultNotice, updateJob.isError]);

  const phaseLabel = job?.phase ? PHASE_LABEL[job.phase] : 'Starting update…';
  const canUpdate = checkResult?.status === 'update-available' && !jobId && !resultNotice;
  const checkLabel = isChecking
    ? 'Checking…'
    : checkResult || checkError
      ? 'Check again'
      : 'Check for updates';

  return (
    <section className="form-section anim-enter" id="system">
      <h2 className="form-section__title">Updates &amp; about</h2>
      <p className="form-section__desc">Keep Sur9e current without losing your place.</p>

      <div className={`system-update-panel system-update-panel--${status.tone}`}>
        <div className="system-update-panel__version">
          <span className="system-update-panel__eyebrow">Installed version</span>
          <strong id="aboutVersion">v{installedVersion}</strong>
        </div>
        <div
          className="system-update-panel__status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="system-update-panel__badge">{status.badge}</span>
          <span className="system-update-panel__detail">{status.detail}</span>
        </div>

        {checkResult?.status === 'update-available' && checkResult.changelog.trim() ? (
          <p className="system-update-panel__changelog">
            <strong>What&rsquo;s new:</strong> {changelogExcerpt(checkResult.changelog)}
          </p>
        ) : null}

        {job?.phase === 'failed' || checkError ? (
          <div className="system-update-panel__error" role="alert">
            <strong>
              {job?.phase === 'failed' ? 'Update failed.' : 'Could not check for updates.'}
            </strong>{' '}
            {job?.phase === 'failed' ? job.error : checkError} Use Roll back below if the installed
            version needs recovery; otherwise try checking again.
          </div>
        ) : null}

        <div className="system-update-panel__actions">
          {jobRunning ? (
            <Button variant="primary" size="lg" disabled>
              {phaseLabel}
            </Button>
          ) : canUpdate ? (
            <Button variant="primary" size="lg" onClick={applyUpdate} disabled={actionsPending}>
              {isApplying ? 'Starting update…' : 'Update now'}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="lg"
            id="checkUpdates"
            onClick={checkUpdates}
            disabled={actionsPending}
          >
            {checkLabel}
          </Button>
        </div>
      </div>

      <div className="system-update-row">
        <div className="system-update-row__content">
          <span className="system-update-row__label">Update source</span>
          <span className="system-update-row__summary">
            <code translate="no">{source}</code>
            <span aria-hidden="true">·</span>
            <code translate="no">{branch}</code>
          </span>
        </div>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => setEditingSource(value => !value)}
          disabled={actionsPending}
          aria-expanded={editingSource}
          aria-controls="system-update-source-fields"
          aria-label={editingSource ? 'Close update source editor' : 'Edit update source'}
        >
          {editingSource ? 'Done' : 'Edit'}
        </Button>
      </div>

      {editingSource ? (
        <div className="system-update-source-fields" id="system-update-source-fields">
          <div className="form-field">
            <Label htmlFor="settings-system-update-source">Update source</Label>
            <Input
              id="settings-system-update-source"
              type="text"
              autoComplete="off"
              spellCheck={false}
              data-adv-text="system.update_source"
              {...register('system.update_source')}
            />
            <HelperText>
              Git remote used by <code>update-system.mjs</code>.
            </HelperText>
          </div>
          <div className="form-field">
            <Label htmlFor="settings-system-update-branch">Update branch</Label>
            <Input
              id="settings-system-update-branch"
              type="text"
              autoComplete="off"
              spellCheck={false}
              data-adv-text="system.update_branch"
              {...register('system.update_branch')}
            />
            <HelperText>
              Branch <code>update-system.mjs</code> tracks.
            </HelperText>
          </div>
        </div>
      ) : null}

      <div className="system-update-row system-update-row--recovery">
        <div className="system-update-row__content">
          <span className="system-update-row__label">Recovery</span>
          <span className="system-update-row__help">Restore the previous installed version.</span>
        </div>
        <Button
          variant="secondary"
          size="lg"
          id="rollback"
          title="Roll back to the previous installed version (asks to confirm)"
          onClick={rollback}
          disabled={actionsPending}
        >
          Roll back
        </Button>
      </div>
    </section>
  );
}
