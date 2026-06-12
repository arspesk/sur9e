'use client';

// Orchestrator for the nine section components. Auto-save (600ms
// debounce) + "Saved" toast lives in useProfileForm. The required-field
// banner sources from rhf formState.errors for rhf-managed fields, plus
// cvHasContent for the MdSection-managed CV file.

import { useEffect, useRef, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { Button, Separator } from '@/components/primitives';
import type { ProfileState } from '@/hooks/use-profile';
// Type-only import from a server-only module — erased at compile time.
import type { ProfileLoadError } from '@/lib/server/profile';
import { useProfileForm } from './hooks/use-profile-form';
import { ApplySection } from './sections/apply-section';
import { CompSection } from './sections/comp-section';
import { CvSection } from './sections/cv-section';
import { DigestSection } from './sections/digest-section';
import { IdentitySection } from './sections/identity-section';
import { LocationSection } from './sections/location-section';
import { NarrativeSection } from './sections/narrative-section';
import { PitchSection } from './sections/pitch-section';
import { TargetsSection } from './sections/targets-section';

interface ProfileFormProps {
  initialData?: ProfileState;
  /** Set when profile.yml exists but failed to parse (server-detected). */
  loadError?: ProfileLoadError | null;
}

export function ProfileForm({ initialData, loadError }: ProfileFormProps = {}) {
  // When profile.yml is unreadable, auto-save is paused: saving would merge
  // the form's (empty) values over a base of `{}` and overwrite the user's
  // hand-edited file. The banner below explains; the hook toasts once if the
  // user edits anyway.
  const saveBlockedReason = loadError
    ? `Saving is paused — ${loadError.path} couldn't be read. Fix or remove the file, then reload this page.`
    : null;
  const { form, query } = useProfileForm({ initialData, saveBlockedReason });

  // CV markdown presence — managed outside rhf (MdSection has its own store).
  // Lifted here so collectMissingRequired can include the req-cv rule.
  // Tri-state: null = unknown (CV file still loading), true/false = known.
  // The required-fields banner only fires the cv rule once we've actually
  // confirmed the file is empty — prevents a flash of "CV markdown missing"
  // on every /profile mount while the async md fetch is in flight.
  const [cvHasContent, setCvHasContent] = useState<boolean | null>(null);

  const missingRequired = collectMissingRequired(form.formState.errors, cvHasContent);

  // The visual banner is rebuilt on every keystroke (rhf recomputes errors),
  // which would make an aria-live region on it re-announce constantly. Gate
  // the announcement on the SET of missing ids actually changing: the visual
  // banner is now aria-live="off" (sighted-only), and a dedicated sr-only
  // region carries text that updates only when the missing-field signature
  // shifts (complete→incomplete or a field added/cleared) — so SR users hear
  // it once per real change, not per keystroke. The signature is the join of
  // missing ids; the effect runs (and re-announces) only when it changes.
  const missingSignature = missingRequired.map(r => r.id).join('|');
  const missingLabels = missingRequired.map(r => r.label).join(', ');
  const [srMessage, setSrMessage] = useState('');
  const prevSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    // Skip the initial mount: only announce on a real change, never the
    // page-load snapshot ("All required fields complete" the moment the
    // form renders clean would be noise).
    if (prevSignatureRef.current === null) {
      prevSignatureRef.current = missingSignature;
      return;
    }
    prevSignatureRef.current = missingSignature;
    setSrMessage(
      missingSignature
        ? `Required fields missing: ${missingLabels}`
        : 'All required fields complete',
    );
    // missingLabels is derived from missingSignature; only re-announce when
    // the set of missing fields actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingSignature]);

  // No `query.isPending` short-circuit: app/profile/page.tsx unconditionally
  // passes initialData, so the TanStack query starts in success state on
  // first render and `isPending` never flips true. The route-level
  // loading.tsx covers Suspense fallback for slow nav transitions.
  // Placed after the hooks above so the Rules of Hooks hold on the error path.
  if (query.error) {
    // Inline error panel instead of `return null`: a refetch failure (e.g.
    // server briefly down during window-focus refetch) used to unmount the
    // whole form, leaving a blank page once the toast expired. Reuses the
    // danger-banner styling; Retry refetches in place.
    const msg = query.error instanceof Error ? query.error.message : String(query.error);
    return (
      <div className="profile-content">
        <div className="profile-required-banner is-visible" role="alert">
          <strong>Couldn&rsquo;t load your profile</strong>
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
      <div className="profile-content">
        <span className="sr-only" role="status" aria-live="polite">
          {srMessage}
        </span>
        {loadError && (
          // Parse-error banner: the file EXISTS but couldn't be read, so the
          // form below shows empty values — say so, name the file, show the
          // cause, and explain why saving is paused. Reuses the
          // .profile-required-banner danger styling (style sheet additions are
          // out of scope for this fail-soft fix).
          <div className="profile-required-banner is-visible" role="alert">
            <strong>Your profile file couldn&rsquo;t be read</strong>
            <div>
              <code>{loadError.path}</code> exists but failed to parse
              {loadError.line != null ? ` (line ${loadError.line})` : ''}: {loadError.message}
            </div>
            <div>
              The form below shows empty values and saving is paused so your file isn&rsquo;t
              overwritten. Fix or remove the file, then reload this page.
            </div>
          </div>
        )}
        <div
          className={`profile-required-banner${missingRequired.length > 0 ? ' is-visible' : ''}`}
          id="requiredBanner"
          aria-live="off"
        >
          <strong>Required fields missing</strong>
          <ul id="requiredBannerList">
            {missingRequired.map(r => (
              <li key={r.id}>
                <a
                  href={`#${r.section}`}
                  data-required-id={r.id}
                  onClick={e => {
                    e.preventDefault();
                    const sec = document.getElementById(r.section);
                    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    requestAnimationFrame(() => {
                      const target =
                        document.querySelector<HTMLElement>(
                          `${r.selector} input, ${r.selector} textarea, ${r.selector} select`,
                        ) || document.querySelector<HTMLElement>(r.selector);
                      target?.focus({ preventScroll: true });
                    });
                  }}
                >
                  {r.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="profile-layout">
          <nav className="profile-nav" aria-label="Profile sections">
            <a href="#identity" className="profile-nav__item is-active">
              Identity
            </a>
            <a href="#targets" className="profile-nav__item">
              Targets
            </a>
            <a href="#pitch" className="profile-nav__item">
              Pitch
            </a>
            <a href="#comp" className="profile-nav__item">
              Comp
            </a>
            <a href="#location" className="profile-nav__item">
              Location
            </a>
            <a href="#apply" className="profile-nav__item">
              Apply
            </a>
            <Separator className="profile-nav__sep" />
            <a href="#cv" className="profile-nav__item">
              CV
            </a>
            <a href="#narrative" className="profile-nav__item">
              Narrative
            </a>
            <a href="#digest" className="profile-nav__item">
              Digest
            </a>
          </nav>

          <div className="profile-form">
            <IdentitySection />
            <TargetsSection />
            <PitchSection />
            <CompSection />
            <LocationSection />
            <ApplySection />
            <CvSection onCvContent={setCvHasContent} />
            <NarrativeSection />
            <DigestSection />
          </div>
        </div>
      </div>
    </FormProvider>
  );
}

// ── Required-field banner helper (private to this orchestrator) ──
// Walks rhf's formState.errors for the 5 rhf-managed required rules,
// then appends the cv-presence rule (cvHasContent from MdSection state).
// Produces the same { id, label, section, selector } shape as the legacy
// REQUIRED_FIELDS array so the banner anchor + focus behavior is identical.

interface RequiredRow {
  id: string;
  label: string;
  section: string;
  selector: string;
}

function collectMissingRequired(
  errors: Record<string, unknown>,
  cvHasContent: boolean | null,
): RequiredRow[] {
  const rows: RequiredRow[] = [];
  const e = errors as Record<string, Record<string, { message?: string } | undefined>>;

  if (e.candidate?.full_name)
    rows.push({
      id: 'req-full_name',
      label: 'Full name',
      section: 'identity',
      selector: '[data-key="candidate.full_name"]',
    });
  if (e.candidate?.email)
    rows.push({
      id: 'req-email',
      label: 'Email',
      section: 'identity',
      selector: '[data-key="candidate.email"]',
    });
  if (e.target_roles?.archetypes)
    rows.push({
      id: 'req-archetype',
      label: 'At least one archetype',
      section: 'targets',
      selector: '[data-rowlist="target_roles.archetypes"]',
    });
  if (e.search?.terms)
    rows.push({
      id: 'req-terms',
      label: 'At least one search keyword',
      section: 'targets',
      selector: '[data-chiplist="search.terms"]',
    });
  if (e.compensation?.target_range)
    rows.push({
      id: 'req-target_range',
      label: 'Target range',
      section: 'comp',
      selector: '[data-key="compensation.target_range"]',
    });
  if (e.search?.locations)
    rows.push({
      id: 'req-locations',
      label: 'At least one search location',
      section: 'location',
      selector: '[data-chiplist="search.locations"]',
    });
  // Tri-state: null = unknown (still loading); only emit the rule once
  // we've confirmed the file is empty (false).
  if (cvHasContent === false)
    rows.push({
      id: 'req-cv',
      label: 'CV markdown',
      section: 'cv',
      selector: '#cv',
    });

  return rows;
}
