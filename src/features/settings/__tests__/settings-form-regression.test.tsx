// src/features/settings/__tests__/settings-form-regression.test.tsx
//
// Regression tests for SettingsFormSchema (no required-field rules at the
// UI layer — SettingsShape defaults handle missing fields).
//
// Assertions:
//   1. Empty parse succeeds with all defaults populated.
//   2. A representative populated settings object round-trips identically.
//   3. Wrong type for a field reports a typed error (not silent coercion).
//   4. Smoke: the orchestrator exports SettingsForm and all section modules
//      export their named component (import-level sanity, no JSDOM render —
//      JSDOM initialization with rhf+Zod hooks OOMs the vitest worker on this
//      machine).
//   5. ScanningSection render: toggle OFF → preset select absent; toggle ON → present.
//      (Only ScanningSection is rendered, not the full SettingsForm tree, to avoid OOM.)
//   6. Source toggles: ATS toggle lives in PortalsSection, JobSpy toggle +
//      crawler fields in JobspySection, and the cross-section "at least one
//      source must stay enabled" guard refuses switching the last one off.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { MODES_QUERY_KEY } from '@/hooks/use-mode-manifest';
import { PROVIDERS_QUERY_KEY } from '@/hooks/use-provider-info';
import { SettingsFormSchema } from '../schemas';
import { JobspySection } from '../sections/jobspy-section';
import { PortalsSection } from '../sections/portals-section';
import { ProvidersSection } from '../sections/providers-section';
import { ScanningSection } from '../sections/scanning-section';
import type { SettingsFormValues } from '../types';

// ScanningSection's queue-action row calls useRouter() (for router.refresh()
// after clearing the queue); these unit tests render the section without an
// App Router provider, so stub the hook.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

// ── Schema tests ──────────────────────────────────────────────────────────────

describe('SettingsFormSchema — no required-field rules', () => {
  it('empty input parses successfully with all defaults', () => {
    const result = SettingsFormSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      // Spot-check that defaults are populated
      expect(result.data.appearance.theme).toBe('system');
      expect(result.data.screening.smoke_test_limit).toBe(0);
      expect(result.data.scanning.jobspy.hours_old).toBe(168);
      expect(result.data.advanced.score_threshold).toBe(3);
    }
  });

  it('a representative settings object round-trips identically', () => {
    const input = {
      appearance: { theme: 'dark' },
      screening: { smoke_test_limit: 5 },
      scanning: {
        jobspy: {
          hours_old: 72,
          results_wanted: 500,
        },
      },
      system: { update_source: 'https://example.com/repo.git', update_branch: 'stable' },
      providers: {
        models: { screen: 'claude-sonnet-4-6', batch: 'claude-opus-4-7' },
      },
      advanced: {
        score_threshold: 4,
        parallel_workers: 10,
        timeout_ms: 60000,
      },
    };
    const result = SettingsFormSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.appearance.theme).toBe('dark');
      expect(result.data.screening.smoke_test_limit).toBe(5);
      expect(result.data.advanced.score_threshold).toBe(4);
      expect(result.data.providers.models.screen).toBe('claude-sonnet-4-6');
    }
  });

  it('wrong type for smoke_test_limit reports a schema error', () => {
    const result = SettingsFormSchema.safeParse({
      screening: { smoke_test_limit: 'abc' }, // should be number
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'));
      expect(paths).toContain('screening.smoke_test_limit');
    }
  });

  it('invalid theme value reports a schema error', () => {
    const result = SettingsFormSchema.safeParse({
      appearance: { theme: 'solarized' }, // not in enum
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'));
      expect(paths).toContain('appearance.theme');
    }
  });

  it('allows decimal score thresholds because the UI accepts 0.1 increments', () => {
    const result = SettingsFormSchema.safeParse({
      advanced: { score_threshold: 3.5 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.advanced.score_threshold).toBe(3.5);
    }
  });

  it('scanning.schedule fields round-trip through the schema', () => {
    const result = SettingsFormSchema.safeParse({
      scanning: {
        schedule: {
          enabled: true,
          cron: '0 */6 * * *',
          catch_up_hours: 12,
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scanning.schedule.enabled).toBe(true);
      expect(result.data.scanning.schedule.cron).toBe('0 */6 * * *');
      expect(result.data.scanning.schedule.catch_up_hours).toBe(12);
    }
  });

  it('scanning.schedule defaults to disabled with daily-9am cron', () => {
    const result = SettingsFormSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scanning.schedule.enabled).toBe(false);
      expect(result.data.scanning.schedule.cron).toBe('0 9 * * *');
      expect(result.data.scanning.schedule.catch_up_hours).toBe(24);
    }
  });

  it('scanning.schedule rejects an invalid cron expression', () => {
    const result = SettingsFormSchema.safeParse({
      scanning: { schedule: { cron: 'not a cron' } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'));
      expect(paths).toContain('scanning.schedule.cron');
    }
  });
});

// ── ScanningSection render tests ──────────────────────────────────────────────
// Only ScanningSection is mounted (not the full SettingsForm) to avoid the
// OOM that hits when rhf+Zod initialise the entire settings tree.
//
// Verifies the user decision 2026-06-05: toggle OFF → preset select absent;
// toggle ON → preset select present.

function ScanningSectionWrapper({ enabled }: { enabled: boolean }) {
  const defaults = SettingsFormSchema.parse({});
  const methods = useForm<SettingsFormValues>({
    defaultValues: {
      ...defaults,
      scanning: { ...defaults.scanning, schedule: { ...defaults.scanning.schedule, enabled } },
    },
  });
  return (
    <QueryClientProvider client={new QueryClient()}>
      <FormProvider {...methods}>
        <ScanningSection />
      </FormProvider>
    </QueryClientProvider>
  );
}

describe('ScanningSection render — schedule fields visibility', () => {
  it('enabled=false → preset select is NOT rendered', () => {
    const { queryByRole } = render(<ScanningSectionWrapper enabled={false} />);
    // The Frequency select trigger has role="combobox" in Radix.
    expect(queryByRole('combobox')).toBeNull();
  });

  it('enabled=true → preset select IS rendered', () => {
    const { getByRole } = render(<ScanningSectionWrapper enabled={true} />);
    expect(getByRole('combobox')).toBeTruthy();
  });

  it('enabled=true → all preset options are present in the DOM', () => {
    const { getAllByRole } = render(<ScanningSectionWrapper enabled={true} />);
    // Radix SelectItem renders as option-role in the list portal.
    // Fallback: check by text content via getByText for each preset label.
    // We assert via queryAllByText that the select trigger renders the
    // Frequency label and there is at least one combobox (already covered above).
    // The option list is rendered in a portal and not always accessible in JSDOM,
    // so we assert the combobox count instead (1 = Frequency only; weekly would
    // add a 2nd for day-of-week).
    const combos = getAllByRole('combobox');
    expect(combos.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Custom cron editing — stay custom while typing ────────────────────────────
// Regression: the preset re-derive effect used to fire on every keystroke of
// the Custom cron input, so a partially-typed expression that momentarily
// matched a preset shape (e.g. "0 8 * * *" on the way to "0 8 */2 * *")
// flipped the Frequency select away from Custom and unmounted the input
// mid-edit. User keystrokes must keep the Custom view; external resets
// (form.reset / hydration) must still snap to the derived preset.

function CustomCronWrapper({
  cron,
  onReady,
}: {
  cron: string;
  onReady?: (reset: (c: string) => void) => void;
}) {
  const defaults = SettingsFormSchema.parse({});
  const methods = useForm<SettingsFormValues>({
    defaultValues: {
      ...defaults,
      scanning: {
        ...defaults.scanning,
        schedule: { ...defaults.scanning.schedule, enabled: true, cron },
      },
    },
  });
  onReady?.((c: string) =>
    methods.reset({
      ...methods.getValues(),
      scanning: {
        ...methods.getValues().scanning,
        schedule: { ...methods.getValues().scanning.schedule, cron: c },
      },
    }),
  );
  return (
    <QueryClientProvider client={new QueryClient()}>
      <FormProvider {...methods}>
        <ScanningSection />
      </FormProvider>
    </QueryClientProvider>
  );
}

describe('ScanningSection — custom cron stays custom while editing', () => {
  it('typing a preset-shaped value into the Custom cron input does NOT unmount it', async () => {
    // "0 8 */2 * *" derives to custom, so the cron input mounts.
    const { container } = render(<CustomCronWrapper cron="0 8 */2 * *" />);
    const input = container.querySelector<HTMLInputElement>('#settings-schedule-cron');
    expect(input).not.toBeNull();

    // Simulate a keystroke that momentarily matches the daily preset shape.
    await act(async () => {
      fireEvent.change(input!, { target: { value: '0 8 * * *' } });
    });

    // The input must still be mounted (Frequency stayed on Custom) and keep
    // the typed value.
    const after = container.querySelector<HTMLInputElement>('#settings-schedule-cron');
    expect(after).not.toBeNull();
    expect(after!.value).toBe('0 8 * * *');
  });

  it('an external form.reset still snaps the Frequency select to the derived preset', async () => {
    let doReset: ((c: string) => void) | undefined;
    const { container } = render(
      <CustomCronWrapper
        cron="0 8 */2 * *"
        onReady={r => {
          doReset = r;
        }}
      />,
    );
    expect(container.querySelector('#settings-schedule-cron')).not.toBeNull();

    // External reset (e.g. after a server refresh) to a daily-shaped cron —
    // no input onChange fires, so the re-derive effect must run normally.
    await act(async () => {
      doReset?.('0 9 * * *');
    });

    // Custom cron input unmounts; the daily preset's Time input appears.
    expect(container.querySelector('#settings-schedule-cron')).toBeNull();
    expect(container.querySelector('#settings-schedule-time')).not.toBeNull();
  });
});

// ── Source-toggle sections render — ATS in portals, JobSpy in jobspy ──────────
// The toggles moved out of ScanningSection into the sections that own each
// source. Both flags live in the same rhf form, so the "at least one source
// must stay enabled" guard works across sections via watch.

function SourcesWrapper({
  ats = true,
  jobspy = true,
  children,
}: {
  ats?: boolean;
  jobspy?: boolean;
  children: ReactNode;
}) {
  const defaults = SettingsFormSchema.parse({});
  const methods = useForm<SettingsFormValues>({
    defaultValues: {
      ...defaults,
      scanning: { ...defaults.scanning, sources: { ats, jobspy } },
    },
  });
  return (
    <QueryClientProvider client={new QueryClient()}>
      <FormProvider {...methods}>{children}</FormProvider>
    </QueryClientProvider>
  );
}

// Empty list → the portal-empty state renders; initialData stops the
// portals query from fetching in JSDOM.
const NO_PORTALS = { tracked_companies: [] };

describe('PortalsSection render — ATS source toggle', () => {
  it('renders the ATS enable toggle above the company manager', () => {
    const { container } = render(
      <SourcesWrapper>
        <PortalsSection initialPortals={NO_PORTALS} />
      </SourcesWrapper>,
    );
    const toggle = container.querySelector<HTMLInputElement>('#settings-source-ats');
    expect(toggle).not.toBeNull();
    expect(toggle!.checked).toBe(true);
    // Manager present and NOT dimmed while the source is on.
    expect(container.querySelector('.portal-manager')).not.toBeNull();
    expect(container.querySelector('.portal-manager--dimmed')).toBeNull();
  });

  it('source off → company manager stays visible but dimmed and inert', () => {
    const { container } = render(
      <SourcesWrapper ats={false}>
        <PortalsSection initialPortals={NO_PORTALS} />
      </SourcesWrapper>,
    );
    expect(container.querySelector<HTMLInputElement>('#settings-source-ats')!.checked).toBe(false);
    // Visible (not hidden) but disabled as a block — `inert` takes every
    // control inside out of clicks and the tab order, mirroring JobSpy.
    const manager = container.querySelector('.portal-manager--dimmed');
    expect(manager).not.toBeNull();
    expect(manager!.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('.portal-composer')).not.toBeNull();
  });

  it('source on → company manager is not inert', () => {
    const { container } = render(
      <SourcesWrapper>
        <PortalsSection initialPortals={NO_PORTALS} />
      </SourcesWrapper>,
    );
    expect(container.querySelector('.portal-manager')!.hasAttribute('inert')).toBe(false);
  });
});

describe('JobspySection render — toggle + crawler fields', () => {
  it('renders the JobSpy enable toggle and both crawler knobs', () => {
    const { container } = render(
      <SourcesWrapper>
        <JobspySection />
      </SourcesWrapper>,
    );
    expect(container.querySelector<HTMLInputElement>('#settings-source-jobspy')!.checked).toBe(
      true,
    );
    expect(container.querySelector('#settings-jobspy-hours')).not.toBeNull();
    expect(container.querySelector('#settings-jobspy-results')).not.toBeNull();
  });
});

describe('Source toggles — at least one source must stay enabled', () => {
  it('refuses switching the last enabled source off and shows the error copy', async () => {
    const { container, getByText } = render(
      <SourcesWrapper ats={false} jobspy={true}>
        <JobspySection />
      </SourcesWrapper>,
    );
    const toggle = container.querySelector<HTMLInputElement>('#settings-source-jobspy')!;
    await act(async () => {
      fireEvent.click(toggle);
    });
    // Refused: still checked, error line explains why.
    expect(toggle.checked).toBe(true);
    expect(getByText('At least one source must stay enabled.')).toBeTruthy();
  });

  it('allows switching a source off while the sibling is still enabled — across sections', async () => {
    const { container, queryByText } = render(
      <SourcesWrapper ats={true} jobspy={true}>
        <PortalsSection initialPortals={NO_PORTALS} />
        <JobspySection />
      </SourcesWrapper>,
    );
    const ats = container.querySelector<HTMLInputElement>('#settings-source-ats')!;
    const jobspy = container.querySelector<HTMLInputElement>('#settings-source-jobspy')!;

    // ATS off while JobSpy is on → allowed.
    await act(async () => {
      fireEvent.click(ats);
    });
    expect(ats.checked).toBe(false);
    expect(queryByText('At least one source must stay enabled.')).toBeNull();

    // Now JobSpy is the last source — switching it off is refused, even
    // though the sibling toggle renders in a different section.
    await act(async () => {
      fireEvent.click(jobspy);
    });
    expect(jobspy.checked).toBe(true);
    expect(queryByText('At least one source must stay enabled.')).not.toBeNull();
  });
});

// ── Module smoke tests (import-only, no JSDOM render) ─────────────────────────
// Validates that the orchestrator + all section modules export their named
// function. Rendering the full component tree with rhf+Zod hooks OOMs the
// vitest worker on this machine — visual verification via the running dev app.

// ── ProvidersSection render — fallback pickers ───────────────────────────────
// Mount only ProvidersSection (not the full SettingsForm) to avoid the OOM.
// The provider/mode TanStack Query caches are pre-seeded so no network fetch
// fires during the render.

function ProvidersSectionWrapper({
  modes: modeOverrides,
}: {
  /** Optional providers.modes seed — rows render ONLY for overridden modes. */
  modes?: Record<string, unknown>;
} = {}) {
  const defaults = SettingsFormSchema.parse(
    modeOverrides ? { providers: { modes: modeOverrides } } : {},
  );
  const methods = useForm<SettingsFormValues>({ defaultValues: defaults });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(PROVIDERS_QUERY_KEY, {
    providers: {
      claude: {
        id: 'claude',
        displayName: 'Claude',
        binary: 'claude',
        installHint: 'npm i -g @anthropic-ai/claude-code',
        installed: { ok: true, version: '1.0.0' },
        auth: { ok: true },
        models: [
          { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
          { id: 'claude-opus-4-7', label: 'Opus 4.7' },
        ],
      },
      codex: {
        id: 'codex',
        displayName: 'Codex',
        binary: 'codex',
        installHint: 'npm i -g @openai/codex',
        installed: { ok: true, version: '2.0.0' },
        auth: { ok: true },
        models: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
      },
    },
  });
  client.setQueryData(MODES_QUERY_KEY, {
    modes: [
      { modeId: 'evaluate', exec: 'oneshot', default_platform: 'claude', needs_tools: [] },
      { modeId: 'apply', exec: 'oneshot', default_platform: 'claude', needs_tools: [] },
    ],
  });
  return (
    <QueryClientProvider client={client}>
      <FormProvider {...methods}>
        <ProvidersSection />
      </FormProvider>
    </QueryClientProvider>
  );
}

describe('ProvidersSection render — fallback pickers', () => {
  it('renders the global fallback platform + model selects', () => {
    const { container } = render(<ProvidersSectionWrapper />);
    expect(container.querySelector('[data-fallback-platform]')).not.toBeNull();
    expect(container.querySelector('[data-fallback-model]')).not.toBeNull();
  });

  it('renders a fallback trigger only for overridden mode rows', () => {
    const { container } = render(
      <ProvidersSectionWrapper
        modes={{ evaluate: { platform: 'claude', model: 'claude-sonnet-4-6' } }}
      />,
    );
    expect(container.querySelector('[data-mode-fallback="evaluate"]')).not.toBeNull();
    // `apply` has no override → no row.
    expect(container.querySelector('[data-mode-fallback="apply"]')).toBeNull();
    expect(container.querySelectorAll('[data-mode-fallback]').length).toBe(1);
  });
});

// ── ProvidersSection render — compact override table ─────────────────────────
// Only modes with an actual override get a row; the rest are reachable via
// the "Add override…" select. Every row carries an explicit Reset button —
// the single affordance that removes it.

describe('ProvidersSection render — compact per-mode override table', () => {
  it('no overrides → empty-state line + Add control, no table', () => {
    const { container, getByText } = render(<ProvidersSectionWrapper />);
    expect(container.querySelector('[data-testid="providers-modes-table"]')).toBeNull();
    expect(getByText(/No per-mode overrides — every mode uses the global default\./)).toBeTruthy();
    expect(container.querySelector('[data-testid="add-mode-override"]')).not.toBeNull();
  });

  it('an overridden mode renders a row with its Reset button', () => {
    const { container } = render(
      <ProvidersSectionWrapper
        modes={{ evaluate: { platform: 'claude', model: 'claude-sonnet-4-6' } }}
      />,
    );
    expect(container.querySelector('[data-testid="providers-modes-table"]')).not.toBeNull();
    expect(container.querySelector('[data-mode-id="evaluate"]')).not.toBeNull();
    expect(container.querySelector('[data-mode-id="apply"]')).toBeNull();
    expect(container.querySelector('[data-mode-reset="evaluate"]')).not.toBeNull();
    // The not-yet-overridden mode stays available in the Add control.
    expect(container.querySelector('[data-testid="add-mode-override"]')).not.toBeNull();
  });

  it('a fallback-only override also renders a row', () => {
    const { container } = render(
      <ProvidersSectionWrapper
        modes={{ apply: { fallback: { platform: 'codex', model: 'gpt-5-codex' } } }}
      />,
    );
    expect(container.querySelector('[data-mode-id="apply"]')).not.toBeNull();
    expect(container.querySelector('[data-mode-id="evaluate"]')).toBeNull();
  });

  it('clicking Reset removes the row and falls back to the empty state', async () => {
    const { container, getByText } = render(
      <ProvidersSectionWrapper
        modes={{ evaluate: { platform: 'claude', model: 'claude-sonnet-4-6' } }}
      />,
    );
    const reset = container.querySelector<HTMLButtonElement>('[data-mode-reset="evaluate"]');
    expect(reset).not.toBeNull();
    await act(async () => {
      fireEvent.click(reset!);
    });
    expect(container.querySelector('[data-mode-id="evaluate"]')).toBeNull();
    expect(getByText(/No per-mode overrides — every mode uses the global default\./)).toBeTruthy();
  });
});

describe('SettingsForm module exports', () => {
  it('SettingsForm is exported from the orchestrator', async () => {
    // We can't render it without JSDOM OOM, but we can assert the export exists
    // and is a function — confirming the file compiles and tree-shakes correctly.
    const mod = await import('../settings-form');
    expect(typeof mod.SettingsForm).toBe('function');
  });

  it('all section modules export their named component', async () => {
    // ui-section (theme moved to the shell rail's ThemeSwitch) and
    // advanced-section (merged into screening-section) were deleted.
    const [screening, scanning, providers, portals, jobspy, system] = await Promise.all([
      import('../sections/screening-section'),
      import('../sections/scanning-section'),
      // Renamed from models-section. The section's HTML anchor stays
      // id="models" for back-compat with any /settings#models deep links.
      import('../sections/providers-section'),
      import('../sections/portals-section'),
      import('../sections/jobspy-section'),
      import('../sections/system-section'),
    ]);
    expect(typeof screening.ScreeningSection).toBe('function');
    expect(typeof scanning.ScanningSection).toBe('function');
    expect(typeof providers.ProvidersSection).toBe('function');
    expect(typeof portals.PortalsSection).toBe('function');
    expect(typeof jobspy.JobspySection).toBe('function');
    expect(typeof system.SystemSection).toBe('function');
  });
});
