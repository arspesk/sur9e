'use client';

// Search section: shared scan machinery — queue status + Scheduled scans.
// Per-source toggles + knobs live in their own sections (ATS portals,
// JobSpy). Search keywords + locations live in Profile → Targets (single
// source of truth for what both scanners query).
// Section ID: "search".

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import {
  Button,
  ErrorText,
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/primitives';
import { useToastStore } from '@/components/toast/toast-store';
import { useJobAction } from '@/hooks/use-job-action';
import { useJobLock } from '@/hooks/use-job-lock';
import type { ScheduleState } from '@/lib/server/jobs/schedule-logic';
import type { ScanQueueStatus } from '@/lib/server/scan-status';
import { clearPendingQueueAction } from '@/server/actions/pipeline';
import type { SettingsFormValues } from '../types';
import { cronToPreset, PRESET_LABELS, presetToCron, type SchedulePreset } from './schedule-presets';

// ── Last-run label map ──────────────────────────────────────────────────────
// HONESTY: 'started' means createJob was called and the job record was written;
// the scan itself runs asynchronously. NEVER render "done" or "succeeded" here.
// The job deck shows actual completion. This is by design — spec §4.
const LAST_RESULT_LABELS: Record<NonNullable<ScheduleState['last_result']>, string> = {
  started: 'Started',
  error: 'Failed to start',
  skipped: 'Skipped (another scan was running)',
};

function formatLastRun(state: ScheduleState): string | null {
  if (!state.last_run || !state.last_result) return null;
  const date = new Date(state.last_run);
  const formatted = date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const label = LAST_RESULT_LABELS[state.last_result] ?? state.last_result;
  return `${formatted} — ${label}`;
}

// ── Last-scan label ─────────────────────────────────────────────────────────
// Absolute time + a coarse relative hint. Client-side only (uses the local
// clock), so it renders after mount to avoid an SSR/client mismatch.
function formatLastScan(iso: string): string {
  const then = new Date(iso);
  const abs = then.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  let rel: string;
  if (mins < 1) rel = 'just now';
  else if (mins < 60) rel = `${mins} min ago`;
  else if (mins < 1440) rel = `${Math.round(mins / 60)}h ago`;
  else rel = `${Math.round(mins / 1440)}d ago`;
  return `${abs} · ${rel}`;
}

// ── Next-run preview ────────────────────────────────────────────────────────
// Client-side only (cron-parser is browser-compatible).
function computeNextRun(cron: string): string | null {
  try {
    // Lazy-import guard: cron-parser is already in the bundle (used by
    // the server schema); this import is direct to avoid async complexity.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CronExpressionParser } = require('cron-parser') as typeof import('cron-parser');
    const next = CronExpressionParser.parse(cron).next().toDate();
    return next.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export interface ScanningSectionProps {
  /** Last scheduler run state read server-side from data/schedule-state.json. */
  lastRunState?: ScheduleState | null;
  /** Pending-queue size + last-scan time, read server-side. */
  queueStatus?: ScanQueueStatus | null;
}

export function ScanningSection({ lastRunState, queueStatus }: ScanningSectionProps = {}) {
  const {
    register,
    control,
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = useFormContext<SettingsFormValues>();

  // ── Queue actions (screen pending / clear queue) ──
  const router = useRouter();
  const pushToast = useToastStore(s => s.push);
  const { run: runScreen } = useJobAction('screen');
  // A running scan/screen is screening the queue already — disable the
  // actions so two screen passes can't race over the same pending rows.
  const { lockReason } = useJobLock();
  const jobBusy = lockReason.size > 0;
  const pendingCount = queueStatus?.pendingCount ?? 0;
  const [clearArmed, setClearArmed] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleScreen = useCallback(() => {
    // queue:true → batch/screen.mjs screens EVERY pending entry (no single
    // url). The loading modal is the feedback; the count refreshes on the
    // next page load. Explicit flag mirrors the /api/jobs/screen contract.
    void runScreen({ queue: true });
  }, [runScreen]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    try {
      const { removed } = await clearPendingQueueAction();
      pushToast(
        'success',
        removed > 0
          ? `Cleared ${removed} offer${removed === 1 ? '' : 's'} from the queue`
          : 'Queue was already empty',
      );
      router.refresh(); // re-renders the server panel with the new count
    } catch (err) {
      pushToast('danger', err instanceof Error ? err.message : 'Failed to clear the queue');
    } finally {
      setClearing(false);
      setClearArmed(false);
    }
  }, [pushToast, router]);

  // ── Derive preset + time from the stored cron ──
  const storedCron = watch('scanning.schedule.cron');
  const scheduleEnabled = watch('scanning.schedule.enabled');

  const [preset, setPreset] = useState<SchedulePreset>(() => cronToPreset(storedCron).preset);
  const [timeValue, setTimeValue] = useState<string>(() => cronToPreset(storedCron).time);
  const [dowValue, setDowValue] = useState<number>(() => cronToPreset(storedCron).dow ?? 1);
  const [domValue, setDomValue] = useState<number>(() => cronToPreset(storedCron).dom ?? 1);

  // Set by the Custom cron input's onChange (i.e. a user keystroke). Lets the
  // re-derive effect below tell typing apart from external value changes —
  // form.reset / hydration never fire the input's onChange.
  const customCronEditRef = useRef(false);

  // When storedCron changes externally (hydration / reset), re-derive preset + extras.
  useEffect(() => {
    // Stay custom while editing: a partially-typed expression can momentarily
    // match a preset shape (e.g. "0 8 * * *" on the way to "0 8 */2 * *"), and
    // re-deriving would flip the Frequency select away from Custom, unmounting
    // the input mid-edit. The cron value is identical either way, so keeping
    // the Custom view is lossless. External resets (flag unset) derive normally
    // and still snap to the right preset.
    if (customCronEditRef.current) {
      customCronEditRef.current = false;
      return;
    }
    const derived = cronToPreset(storedCron);
    setPreset(derived.preset);
    setTimeValue(derived.time);
    if (derived.dow !== undefined) setDowValue(derived.dow);
    if (derived.dom !== undefined) setDomValue(derived.dom);
  }, [storedCron]);

  const handlePresetChange = useCallback(
    (newPreset: SchedulePreset) => {
      setPreset(newPreset);
      if (newPreset !== 'custom') {
        const cron = presetToCron(newPreset, timeValue, dowValue, domValue);
        setValue('scanning.schedule.cron', cron, { shouldValidate: true, shouldDirty: true });
      }
      // For 'custom', keep the current cron and let the user edit it directly.
    },
    [setValue, timeValue, dowValue, domValue],
  );

  const handleTimeChange = useCallback(
    (newTime: string) => {
      setTimeValue(newTime);
      if (preset !== 'custom' && preset !== 'hourly') {
        const cron = presetToCron(preset, newTime, dowValue, domValue);
        setValue('scanning.schedule.cron', cron, { shouldValidate: true, shouldDirty: true });
      }
    },
    [preset, setValue, dowValue, domValue],
  );

  const handleDowChange = useCallback(
    (newDow: number) => {
      setDowValue(newDow);
      if (preset === 'weekly') {
        const cron = presetToCron('weekly', timeValue, newDow, domValue);
        setValue('scanning.schedule.cron', cron, { shouldValidate: true, shouldDirty: true });
      }
    },
    [preset, setValue, timeValue, domValue],
  );

  const handleDomChange = useCallback(
    (newDom: number) => {
      setDomValue(newDom);
      if (preset === 'monthly') {
        const cron = presetToCron('monthly', timeValue, dowValue, newDom);
        setValue('scanning.schedule.cron', cron, { shouldValidate: true, shouldDirty: true });
      }
    },
    [preset, setValue, timeValue, dowValue],
  );

  // ── Last-scan label ──
  // Computed after mount: formatLastScan reads the local clock for the
  // relative hint, which would mismatch the server-rendered string.
  const lastScanAt = queueStatus?.lastScanAt ?? null;
  const [lastScanLabel, setLastScanLabel] = useState<string | null>(null);
  useEffect(() => {
    setLastScanLabel(lastScanAt ? formatLastScan(lastScanAt) : null);
  }, [lastScanAt]);

  // ── Next-run preview ──
  const [nextRunPreview, setNextRunPreview] = useState<string | null>(null);
  useEffect(() => {
    setNextRunPreview(computeNextRun(storedCron));
  }, [storedCron]);

  const cronError = (errors.scanning as Record<string, unknown> | undefined)?.schedule as
    | Record<string, unknown>
    | undefined;
  const cronFieldError = (cronError?.cron as { message?: string } | undefined)?.message;

  const lastRunLine = lastRunState ? formatLastRun(lastRunState) : null;

  return (
    <section className="form-section anim-enter" id="search">
      <h2 className="form-section__title">Job scanning</h2>
      <p className="form-section__desc">
        Scan queue and schedule, shared by every source. Keywords and locations live in{' '}
        <a href="/profile#targets" className="settings-link">
          Profile → Target roles
        </a>{' '}
        — one sieve for both scanners.
      </p>

      {/* ── Queue status panel ── read-only: how many offers are waiting to
          be screened + when the last scan ran. */}
      {queueStatus && (
        <div className="scan-status" aria-live="polite">
          <div className="scan-status__item">
            <span className="scan-status__num">{queueStatus.pendingCount}</span>
            <span className="scan-status__label">
              {queueStatus.pendingCount === 1 ? 'offer' : 'offers'} waiting for screening
            </span>
          </div>
          <div className="scan-status__item">
            <span className="scan-status__label">Last scan</span>
            <span className="scan-status__val">
              {lastScanLabel ?? (lastScanAt ? '…' : 'no scans yet')}
            </span>
          </div>
          <div className="scan-status__actions">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pendingCount === 0 || jobBusy}
              title={
                pendingCount === 0
                  ? 'No offers waiting'
                  : jobBusy
                    ? 'A scan or screen is already running'
                    : undefined
              }
              onClick={handleScreen}
            >
              Screen pending
            </Button>
            {clearArmed ? (
              <>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={clearing}
                  onClick={handleClear}
                >
                  {clearing ? 'Clearing…' : `Clear ${pendingCount}?`}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={clearing}
                  onClick={() => setClearArmed(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pendingCount === 0}
                onClick={() => setClearArmed(true)}
              >
                Clear queue
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Scheduled scans sub-section ── */}
      <div className="settings-subsection">
        <h3 className="settings-subsection__title">Scheduled scans</h3>

        {/* Enable toggle */}
        <div className="form-field" style={{ marginBottom: 'var(--space-3)' }}>
          <label className="schedule-toggle">
            <Controller
              control={control}
              name="scanning.schedule.enabled"
              render={({ field }) => (
                <input
                  type="checkbox"
                  id="settings-schedule-enabled"
                  checked={field.value}
                  onChange={e => field.onChange(e.target.checked)}
                  className="schedule-toggle__input"
                />
              )}
            />
            <span className="schedule-toggle__label" id="settings-schedule-enabled-label">
              Enable scheduled scans
            </span>
          </label>
          <HelperText>
            Runs the full scan → screen → tracker chain on the chosen schedule: new offers arrive
            already screened with a cheap fit check. Full evaluations never run automatically.
          </HelperText>
        </div>

        {/* Everything below — controls AND the honesty note (rendered last) —
            appears ONLY when the schedule is enabled. User decision 2026-06-05:
            toggle off shows nothing but the checkbox itself. */}
        {scheduleEnabled && (
          <>
            {/* Preset select */}
            <div className="form-grid form-grid--cols-2" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="form-field">
                <Label htmlFor="settings-schedule-preset">Frequency</Label>
                <Select value={preset} onValueChange={v => handlePresetChange(v as SchedulePreset)}>
                  <SelectTrigger id="settings-schedule-preset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRESET_LABELS) as SchedulePreset[]).map(key => (
                      <SelectItem key={key} value={key}>
                        {PRESET_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Time input — shown for daily / weekdays / weekends / weekly / monthly */}
              {preset !== 'hourly' && preset !== 'custom' && (
                <div className="form-field">
                  <Label htmlFor="settings-schedule-time">Time</Label>
                  <Input
                    id="settings-schedule-time"
                    type="time"
                    value={timeValue}
                    onChange={e => handleTimeChange(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Day-of-week select — shown for weekly */}
            {preset === 'weekly' && (
              <div
                className="form-grid form-grid--cols-2"
                style={{ marginBottom: 'var(--space-3)' }}
              >
                <div className="form-field">
                  <Label htmlFor="settings-schedule-dow">Day of week</Label>
                  <Select value={String(dowValue)} onValueChange={v => handleDowChange(Number(v))}>
                    <SelectTrigger id="settings-schedule-dow">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        [
                          'Sunday',
                          'Monday',
                          'Tuesday',
                          'Wednesday',
                          'Thursday',
                          'Friday',
                          'Saturday',
                        ] as const
                      ).map((label, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Day-of-month select — shown for monthly */}
            {preset === 'monthly' && (
              <div
                className="form-grid form-grid--cols-2"
                style={{ marginBottom: 'var(--space-3)' }}
              >
                <div className="form-field">
                  <Label htmlFor="settings-schedule-dom">Day of month</Label>
                  <Select value={String(domValue)} onValueChange={v => handleDomChange(Number(v))}>
                    <SelectTrigger id="settings-schedule-dom">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                        <SelectItem key={day} value={String(day)}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <HelperText>Capped at 28 — months shorter than 29 days skip this run.</HelperText>
                </div>
              </div>
            )}

            {/* Custom cron input */}
            {preset === 'custom' && (
              <div className="form-field" style={{ marginBottom: 'var(--space-3)' }}>
                <Label htmlFor="settings-schedule-cron">Cron expression</Label>
                <Input
                  id="settings-schedule-cron"
                  type="text"
                  placeholder="0 9 * * *"
                  invalid={Boolean(cronFieldError)}
                  autoComplete="off"
                  aria-describedby={cronFieldError ? 'settings-schedule-cron-err' : undefined}
                  {...register('scanning.schedule.cron', {
                    validate: value => {
                      if (preset !== 'custom') return true;
                      // Inline validation mirrors the zod refine so errors surface
                      // before the debounced save fires.
                      try {
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        const { CronExpressionParser } =
                          require('cron-parser') as typeof import('cron-parser');
                        CronExpressionParser.parse(value);
                        return true;
                      } catch {
                        return 'Invalid cron expression';
                      }
                    },
                    // Trigger validation on change (not just blur) so the preview
                    // hides and the error shows immediately while typing.
                    onChange: () => {
                      // Mark this cron change as a user keystroke so the
                      // re-derive effect keeps the Frequency select on Custom
                      // instead of unmounting this input mid-edit.
                      customCronEditRef.current = true;
                      void trigger('scanning.schedule.cron');
                    },
                  })}
                />
                <ErrorText id="settings-schedule-cron-err">{cronFieldError}</ErrorText>
                <HelperText>
                  Standard 5-field cron (<code>min hour dom month dow</code>). Minute-level
                  precision.
                </HelperText>
              </div>
            )}

            {/* Next-run preview — hidden when cron is invalid */}
            {!cronFieldError && nextRunPreview && (
              <p className="schedule-next-run" aria-live="polite">
                Next run: <strong>{nextRunPreview}</strong>
              </p>
            )}

            {/* Last-run status line */}
            {lastRunLine && (
              <p className="schedule-last-run">
                Last scheduled run: <strong>{lastRunLine}</strong>
              </p>
            )}

            {/* Honesty note — spec §4 — last, after all fields (user decision). */}
            <p className="schedule-honesty-note">
              Scheduled scans run only while this server is up — a missed window is caught up on
              next start (within 24h).
            </p>
          </>
        )}
      </div>
    </section>
  );
}
