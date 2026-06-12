'use client';

// features/settings/settings-form.tsx — orchestrator (~120 lines)
//
// Decomposes the legacy 965-line monolith into section components.
// Auto-save (600ms debounce) + "Saved" toast lives in useSettingsForm.
// Section IDs are preserved verbatim so the settings-nav anchors and
// toc-rail continue to work.

import { FormProvider } from 'react-hook-form';
import { Button } from '@/components/primitives';
import type { SettingsState } from '@/hooks/use-settings';
import type { PortalsShape } from '@/lib/schemas/portals';
import type { ScheduleState } from '@/lib/server/jobs/schedule-logic';
import type { ScanQueueStatus } from '@/lib/server/scan-status';
// Type-only import from a server-only module — erased at compile time.
import type { SettingsLoadError } from '@/lib/server/settings';
import { useSettingsForm } from './hooks/use-settings-form';
import { JobspySection } from './sections/jobspy-section';
import { PortalsSection } from './sections/portals-section';
import { ProvidersSection } from './sections/providers-section';
import { ScanningSection } from './sections/scanning-section';
import { ScreeningSection } from './sections/screening-section';
import { SystemSection } from './sections/system-section';

interface SettingsFormProps {
  initialData?: SettingsState;
  lastRunState?: ScheduleState | null;
  /** SSR-loaded portals.yml for the ATS portals section (null = no file). */
  initialPortals?: PortalsShape | null;
  queueStatus?: ScanQueueStatus | null;
  /** Set when config.yml exists but failed to parse (server-detected). */
  loadError?: SettingsLoadError | null;
}

export function SettingsForm({
  initialData,
  lastRunState,
  initialPortals,
  queueStatus,
  loadError,
}: SettingsFormProps = {}) {
  // When config.yml is unreadable, every field below shows DEFAULTS (the
  // fail-soft loader degrades) and auto-save is paused: saveSettings refuses
  // to overwrite an unparseable file, so every save would fail. The banner
  // explains; the hook toasts once if the user edits anyway.
  const saveBlockedReason = loadError
    ? `Saving is paused — ${loadError.path} couldn't be read. Fix or remove the file, then reload this page.`
    : null;
  const { form, query } = useSettingsForm({ initialData, saveBlockedReason });

  // No `query.isPending` short-circuit: app/settings/page.tsx unconditionally
  // passes initialData, so the TanStack query starts in success state on
  // first render and `isPending` never flips true. The route-level
  // loading.tsx covers Suspense fallback for slow nav transitions.
  if (query.error) {
    // Inline error panel instead of `return null`: a refetch failure used to
    // unmount the whole page content, leaving only a transient toast. Reuses
    // the danger-banner styling; Retry refetches in place.
    const msg = query.error instanceof Error ? query.error.message : String(query.error);
    return (
      <div className="settings-content">
        <div className="profile-required-banner is-visible" role="alert">
          <strong>Couldn&rsquo;t load settings</strong>
          <div>{msg}</div>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <div className="settings-content">
        {loadError && (
          // Parse-error banner: the file EXISTS but couldn't be read, so
          // every control below shows defaults — say so, name the file, show
          // the cause, and explain why saving is paused. Reuses the
          // .profile-required-banner danger styling (style sheet additions
          // are out of scope for this fail-soft fix).
          <div className="profile-required-banner is-visible" role="alert">
            <strong>Your settings file couldn&rsquo;t be read</strong>
            <div>
              <code>{loadError.path}</code> exists but failed to parse
              {loadError.line != null ? ` (line ${loadError.line})` : ''}: {loadError.message}
            </div>
            <div>
              The controls below show defaults — your saved settings were NOT applied — and saving
              is paused so the file isn&rsquo;t overwritten. Fix or remove the file, then reload
              this page.
            </div>
          </div>
        )}
        <nav className="settings-nav" aria-label="Settings sections">
          <a href="#search" className="settings-nav__item is-active" aria-current="true">
            Job scanning
          </a>
          <a href="#portals" className="settings-nav__item">
            ATS portals
          </a>
          <a href="#jobspy" className="settings-nav__item">
            JobSpy
          </a>
          <a href="#screening" className="settings-nav__item">
            Screening
          </a>
          <a href="#models" className="settings-nav__item">
            AI providers &amp; models
          </a>
          <a href="#system" className="settings-nav__item">
            Updates &amp; about
          </a>
        </nav>

        <ScanningSection lastRunState={lastRunState} queueStatus={queueStatus} />
        {/* The company list is outside the rhf form state on purpose:
             portals.yml is its own file with its own save path — the section
             owns load + debounced save (MdSection precedent). Only the ATS
             source toggle registers through this FormProvider. */}
        <PortalsSection initialPortals={initialPortals} />
        <JobspySection />
        {/* Screening now carries the former Filtering + Performance operator
             knobs (the "Advanced" divider that used to separate them was
             dropped — it would only have labeled Updates & about). */}
        <ScreeningSection />
        <ProvidersSection />
        <SystemSection />
      </div>
    </FormProvider>
  );
}
