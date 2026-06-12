'use client';

// ATS portals section — the ATS source toggle + the company manager for
// inputs/personalization/portals.yml.
// Section ID: "portals".
//
// Two save paths, deliberately separate:
// - The enable toggle is a normal settings field (scanning.sources.ats via
//   useFormContext) — it saves through the settings form's autosave into
//   config.yml.
// - The company manager edits portals.yml, a different file with its own
//   schema, so it owns its load + debounced save via usePortalsQuery /
//   useSavePortals + the shared save-status store (MdSection precedent).
//   Row edits autosave (600ms debounce); the smart-add composer, delete,
//   and example import save immediately.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Button, ErrorText, HelperText, Input, Label, Pill } from '@/components/primitives';
import { useToastStore } from '@/components/toast/toast-store';
import { useImportExamplePortals, usePortalsQuery, useSavePortals } from '@/hooks/use-portals';
import { cn } from '@/lib/cn';
import {
  deriveCompanyFromUrl,
  detectProvider,
  hasCustomParser,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  summarizePortals,
} from '@/lib/portals-detect';
import type { PortalsShape, TrackedCompany } from '@/lib/schemas/portals';
import { useSaveStatusStore } from '@/stores/save-status-store';
import type { SettingsFormValues } from '../types';
import { SourceToggle } from './source-toggle';

const DEBOUNCE_MS = 600;
const SAVED_TOAST_DELAY_MS = 1500;
const EMPTY_PORTALS: PortalsShape = { tracked_companies: [] };

// Every provider the zero-token scanner understands, for the
// "not scannable" helper copy — derives from the single label map so a
// future `custom` provider shows up here automatically.
const SCANNABLE_FEEDS = PROVIDER_ORDER.map(p => PROVIDER_LABELS[p]).join(', ');

type ToneFn = (tone: 'info' | 'success' | 'warning' | 'danger', message: string) => void;

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function hostOf(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

interface RowIssues {
  name?: string;
  careers_url?: string;
}

function rowIssues(company: TrackedCompany): RowIssues {
  const issues: RowIssues = {};
  if (!company.name?.trim()) issues.name = 'Name is required.';
  if (company.careers_url && !isValidHttpUrl(company.careers_url)) {
    issues.careers_url = 'Must be a valid http(s) URL.';
  }
  return issues;
}

function hasInvalidRow(portals: PortalsShape): boolean {
  return portals.tracked_companies.some(c => Object.keys(rowIssues(c)).length > 0);
}

interface PortalsSectionProps {
  /** SSR-loaded portals.yml — null when the file doesn't exist yet. */
  initialPortals?: PortalsShape | null;
}

export function PortalsSection({ initialPortals }: PortalsSectionProps = {}) {
  // Settings-form context — only for the ATS source toggle + the dimmed
  // state of the manager below it. Company-list edits never touch it.
  const { watch } = useFormContext<SettingsFormValues>();
  const atsEnabled = watch('scanning.sources.ats');

  const query = usePortalsQuery({ initialData: initialPortals ?? null });
  const save = useSavePortals();
  const importExample = useImportExamplePortals();
  const pushToast = useToastStore(s => s.push) as ToneFn;
  const setSaveStatus = useSaveStatusStore(s => s.setStatus);

  // Local working copy — source of truth once the user starts editing.
  const [portals, setPortals] = useState<PortalsShape>(() => query.data ?? EMPTY_PORTALS);
  const dirtyRef = useRef(false);

  // Adopt server data until the first local edit (hydration / refetch).
  useEffect(() => {
    if (!dirtyRef.current && query.data !== undefined) {
      setPortals(query.data ?? EMPTY_PORTALS);
    }
  }, [query.data]);

  // Surface load failure as a toast (mirrors MdSection).
  useEffect(() => {
    if (query.error) {
      const msg = query.error instanceof Error ? query.error.message : String(query.error);
      pushToast?.('danger', `Couldn't load portals (${msg}) — reload the page to retry.`);
    }
  }, [query.error, pushToast]);

  // ── Debounced save (mirrors MdSection: flush-on-unmount, Saved toast) ──
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PortalsShape | null>(null);
  const savedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announceSaved = useCallback(() => {
    setSaveStatus('saved');
    if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
    savedToastTimerRef.current = setTimeout(() => {
      pushToast?.('success', 'Saved');
      setSaveStatus('idle');
      savedToastTimerRef.current = null;
    }, SAVED_TOAST_DELAY_MS);
  }, [pushToast, setSaveStatus]);

  const commitSave = useCallback(
    (next: PortalsShape) => {
      save
        .mutateAsync(next)
        .then(() => announceSaved())
        .catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[portals] save failed', err);
          setSaveStatus('error');
          pushToast?.('danger', `Save failed (${msg}) — change a field again to retry.`);
        });
    },
    [announceSaved, pushToast, save, setSaveStatus],
  );

  const applyChange = useCallback(
    (next: PortalsShape, mode: 'debounced' | 'immediate') => {
      dirtyRef.current = true;
      setPortals(next);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
      if (mode === 'immediate') {
        pendingRef.current = null;
        commitSave(next);
        return;
      }
      pendingRef.current = next;
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        const payload = pendingRef.current;
        pendingRef.current = null;
        // Skip saves of invalid mid-edit states (empty name, malformed URL)
        // — the inline field error already tells the user what's wrong.
        if (payload && !hasInvalidRow(payload)) commitSave(payload);
      }, DEBOUNCE_MS);
    },
    [commitSave],
  );

  // Flush a still-pending debounced save on unmount (SPA navigation away
  // from /settings) instead of dropping the user's last edit.
  useEffect(
    () => () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
      const payload = pendingRef.current;
      pendingRef.current = null;
      if (payload && !hasInvalidRow(payload)) commitSave(payload);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Expansion (one row at a time) + focus management ──
  const [expanded, setExpanded] = useState<number | null>(null);
  const expandBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const editorRef = useRef<HTMLDivElement | null>(null);

  // Focus moves into the expanded editor's first field…
  useEffect(() => {
    if (expanded == null) return;
    editorRef.current?.querySelector<HTMLInputElement>('input, textarea')?.focus();
  }, [expanded]);

  // …and back to the row's expand button on collapse.
  const toggleRow = useCallback(
    (idx: number) => {
      if (expanded === idx) {
        setExpanded(null);
        requestAnimationFrame(() => expandBtnRefs.current.get(idx)?.focus());
      } else {
        setExpanded(idx);
      }
    },
    [expanded],
  );

  const companies = portals.tracked_companies;

  // ── Row mutations ──
  const editRow = useCallback(
    (idx: number, key: 'name' | 'careers_url' | 'api' | 'notes', value: string) => {
      const next = [...companies];
      const row: TrackedCompany = { ...next[idx] };
      if (key !== 'name' && value === '') {
        // Cleared optional field — drop the key so the YAML stays tidy.
        delete row[key];
      } else {
        row[key] = value;
      }
      next[idx] = row;
      applyChange({ ...portals, tracked_companies: next }, 'debounced');
    },
    [applyChange, companies, portals],
  );

  const toggleEnabled = useCallback(
    (idx: number, enabled: boolean) => {
      const next = [...companies];
      next[idx] = { ...next[idx], enabled };
      applyChange({ ...portals, tracked_companies: next }, 'debounced');
    },
    [applyChange, companies, portals],
  );

  const removeRow = useCallback(
    (idx: number) => {
      const name = companies[idx]?.name?.trim() || 'company';
      const next = companies.filter((_, i) => i !== idx);
      applyChange({ ...portals, tracked_companies: next }, 'immediate');
      setExpanded(cur => {
        if (cur == null) return cur;
        if (cur === idx) return null;
        return cur > idx ? cur - 1 : cur;
      });
      pushToast?.('info', `Removed ${name}`);
    },
    [applyChange, companies, portals, pushToast],
  );

  // ── Smart-add composer (never autosaves — only explicit Add mutates) ──
  const [draftUrl, setDraftUrl] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  const handleAdd = useCallback(() => {
    const derived = deriveCompanyFromUrl(draftUrl);
    if (!derived) {
      setDraftError(
        draftUrl.trim() ? 'Enter a valid http(s) careers URL.' : 'Paste a careers URL first.',
      );
      return;
    }
    const row: TrackedCompany = {
      name: derived.name,
      careers_url: derived.careers_url,
      ...(derived.api ? { api: derived.api } : {}),
      enabled: true,
    };
    applyChange({ ...portals, tracked_companies: [...companies, row] }, 'immediate');
    setDraftUrl('');
    setDraftError(null);
    // Open the new row so the guessed name is one keystroke from fixed.
    setExpanded(companies.length);
  }, [applyChange, companies, draftUrl, portals]);

  // ── Example-list import (empty state only) ──
  const handleImport = useCallback(() => {
    importExample
      .mutateAsync()
      .then(imported => {
        dirtyRef.current = false;
        setPortals(imported);
        pushToast?.(
          'success',
          `Imported ${imported.tracked_companies.length} companies from the example list`,
        );
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[portals] import failed', err);
        pushToast?.('danger', `Import failed (${msg}).`);
      });
  }, [importExample, pushToast]);

  const summary = summarizePortals(portals);

  const composer = (
    <form
      className="portal-composer"
      onSubmit={e => {
        e.preventDefault();
        handleAdd();
      }}
    >
      <Label htmlFor="portal-add-url">Careers URL</Label>
      <div className="portal-composer__row">
        <Input
          id="portal-add-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://job-boards.greenhouse.io/anthropic"
          value={draftUrl}
          invalid={Boolean(draftError)}
          aria-describedby={draftError ? 'portal-add-url-err' : 'portal-add-url-hint'}
          onChange={e => {
            setDraftUrl(e.target.value);
            if (draftError) setDraftError(null);
          }}
        />
        <Button type="submit" variant="secondary" className="portal-composer__add">
          Add company
        </Button>
      </div>
      <ErrorText id="portal-add-url-err">{draftError}</ErrorText>
      {!draftError && (
        <HelperText id="portal-add-url-hint">
          Paste a careers-page URL — provider, company name, and API endpoint are derived
          automatically.
        </HelperText>
      )}
    </form>
  );

  return (
    <section className="form-section anim-enter" id="portals">
      <h2 className="form-section__title">ATS portals</h2>
      <p className="form-section__desc">
        Companies whose career feeds the zero-token scanner watches. Managed by this screen —
        comments in a hand-written <code>portals.yml</code> are dropped on first save.
      </p>

      <SourceToggle
        name="scanning.sources.ats"
        siblingName="scanning.sources.jobspy"
        id="settings-source-ats"
        label="Enable ATS scanning"
      />

      {/* Company manager — dims and disables while the source is off,
          mirroring JobSpy's fields. `inert` removes every control inside
          (composer, row toggles, editors, import) from clicks and the tab
          order in one place. */}
      <div
        className={cn('portal-manager', !atsEnabled && 'portal-manager--dimmed')}
        inert={!atsEnabled}
      >
        {companies.length === 0 ? (
          <div className="portal-empty">
            <p className="portal-empty__copy">
              The ATS scan fetches each company&rsquo;s career feed directly — {SCANNABLE_FEEDS} —
              with zero AI tokens. Paste a careers URL to start tracking a company, or import the
              curated example list and prune it.
            </p>
            {composer}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleImport}
              loading={importExample.isPending}
            >
              Import the example list
            </Button>
          </div>
        ) : (
          <>
            <p className="portal-summary" aria-live="polite">
              {summary.total} {summary.total === 1 ? 'company' : 'companies'} · {summary.enabled}{' '}
              enabled
              {PROVIDER_ORDER.filter(p => summary.byProvider[p] > 0).map(
                p => ` · ${PROVIDER_LABELS[p]} ${summary.byProvider[p]}`,
              )}
            </p>

            <ul className="portal-list">
              {companies.map((company, idx) => {
                const provider = detectProvider(company);
                const customParser = hasCustomParser(company);
                const disabled = company.enabled === false;
                const isOpen = expanded === idx;
                const issues = rowIssues(company);
                const displayName = company.name?.trim() || 'Untitled company';
                const host = hostOf(company.careers_url);
                const editorId = `portal-editor-${idx}`;
                const showApi = provider === 'greenhouse' || company.api != null;
                const greenhouseMissingApi = provider === 'greenhouse' && !company.api;
                return (
                  <li
                    key={`portal-row-${idx}`}
                    className={cn(
                      'portal-row',
                      disabled && 'portal-row--disabled',
                      isOpen && 'portal-row--open',
                    )}
                  >
                    {/* The whole head is a convenience click-target; keyboard
                       expansion goes through the chevron button inside. */}
                    <div
                      className="portal-row__head"
                      onClick={e => {
                        // The whole row is a click-target, but clicks on the
                        // toggle / delete / chevron handle themselves.
                        if ((e.target as HTMLElement).closest('button, input, a')) return;
                        toggleRow(idx);
                      }}
                    >
                      <span className="portal-row__main">
                        <input
                          type="checkbox"
                          className="schedule-toggle__input"
                          checked={!disabled}
                          aria-label={`Enable ${displayName}`}
                          onChange={e => toggleEnabled(idx, e.target.checked)}
                        />
                        <span className="portal-row__name">{displayName}</span>
                        {provider ? (
                          <Pill className="portal-row__pill">{PROVIDER_LABELS[provider]}</Pill>
                        ) : customParser ? (
                          <Pill className="portal-row__pill portal-row__pill--custom">
                            Custom parser
                          </Pill>
                        ) : (
                          <span className="portal-row__nofeed">not scannable</span>
                        )}
                      </span>
                      <span className="portal-row__meta">
                        {host && <span className="portal-row__host">{host}</span>}
                        <button
                          type="button"
                          className="portal-row__expand"
                          aria-expanded={isOpen}
                          aria-controls={isOpen ? editorId : undefined}
                          aria-label={`Edit ${displayName}`}
                          ref={el => {
                            if (el) expandBtnRefs.current.set(idx, el);
                            else expandBtnRefs.current.delete(idx);
                          }}
                          onClick={() => toggleRow(idx)}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="form-row__remove"
                          aria-label={`Remove ${displayName}`}
                          onClick={() => removeRow(idx)}
                        >
                          ×
                        </button>
                      </span>
                    </div>

                    {isOpen && (
                      <div className="portal-row__editor" id={editorId} ref={editorRef}>
                        <div className="form-grid form-grid--cols-2">
                          <div className="form-field">
                            <Label htmlFor={`portal-${idx}-name`}>Name</Label>
                            <Input
                              id={`portal-${idx}-name`}
                              type="text"
                              autoComplete="off"
                              value={company.name ?? ''}
                              invalid={Boolean(issues.name)}
                              aria-describedby={issues.name ? `portal-${idx}-name-err` : undefined}
                              onChange={e => editRow(idx, 'name', e.target.value)}
                            />
                            <ErrorText id={`portal-${idx}-name-err`}>{issues.name}</ErrorText>
                          </div>
                          <div className="form-field">
                            <Label htmlFor={`portal-${idx}-url`}>Careers URL</Label>
                            <Input
                              id={`portal-${idx}-url`}
                              type="url"
                              inputMode="url"
                              autoComplete="off"
                              value={company.careers_url ?? ''}
                              invalid={Boolean(issues.careers_url)}
                              aria-describedby={
                                issues.careers_url ? `portal-${idx}-url-err` : undefined
                              }
                              onChange={e => editRow(idx, 'careers_url', e.target.value)}
                            />
                            <ErrorText id={`portal-${idx}-url-err`}>{issues.careers_url}</ErrorText>
                          </div>
                        </div>
                        {showApi && (
                          <div className="form-field">
                            <Label htmlFor={`portal-${idx}-api`}>API endpoint</Label>
                            <Input
                              id={`portal-${idx}-api`}
                              type="url"
                              inputMode="url"
                              autoComplete="off"
                              placeholder="https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"
                              value={company.api ?? ''}
                              aria-describedby={`portal-${idx}-api-hint`}
                              onChange={e => editRow(idx, 'api', e.target.value)}
                            />
                            {greenhouseMissingApi ? (
                              <HelperText
                                id={`portal-${idx}-api-hint`}
                                className="portal-row__warning"
                              >
                                Greenhouse needs its boards-api endpoint — without it the scanner
                                skips this company.
                              </HelperText>
                            ) : (
                              <HelperText id={`portal-${idx}-api-hint`}>
                                The JSON feed the scanner fetches. Auto-derived for Greenhouse URLs.
                              </HelperText>
                            )}
                          </div>
                        )}
                        <div className="form-field">
                          <Label htmlFor={`portal-${idx}-notes`}>Notes</Label>
                          <Input
                            id={`portal-${idx}-notes`}
                            type="text"
                            autoComplete="off"
                            value={company.notes ?? ''}
                            aria-describedby={`portal-${idx}-notes-hint`}
                            onChange={e => editRow(idx, 'notes', e.target.value)}
                          />
                          <HelperText id={`portal-${idx}-notes-hint`}>
                            Free text, ignored by the scanner.
                          </HelperText>
                        </div>
                        {provider == null && customParser && (
                          <p className="portal-row__nofeed-note">
                            Scanned by a custom parser script
                            {company.parser?.script ? (
                              <>
                                {' '}
                                (<code>{company.parser.script}</code>)
                              </>
                            ) : null}
                            . Edit the script in your editor, not here — this screen preserves the{' '}
                            <code>parser</code> block as-is.
                          </p>
                        )}
                        {provider == null && !customParser && (
                          <p className="portal-row__nofeed-note">
                            No zero-token feed detected — only {SCANNABLE_FEEDS} career feeds are
                            scanned directly. The JobSpy job-board scraper may still surface this
                            company&rsquo;s roles.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {composer}
          </>
        )}
      </div>
    </section>
  );
}
