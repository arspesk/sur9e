// src/features/profile/__tests__/profile-autosave-hydration.test.tsx
//
// Regression: opening /profile must NOT fire an auto-save (and must not arm
// the beforeunload "unsaved changes" guard) when the user hasn't touched
// anything. The phantom chain was: hydration `form.reset(query.data)` →
// useFieldArray('apply_answers') re-renders → RHF's useFieldArray effect
// unconditionally emits `state.next({ name, values })` → the auto-save watch
// treated it as an edit → debounced PATCH rewrote profile.yml (rotating the
// user's .bak) on every page visit.
//
// The harness mounts the real hook + the real ApplySection (the useFieldArray
// consumer) — the minimal tree that reproduces the emission. TipTap sections
// stay unmounted (JSDOM OOM; see settings-form-regression.test.tsx).

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render } from '@testing-library/react';
import { FormProvider } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileState } from '@/hooks/use-profile';
import { saveProfileAction } from '@/server/actions/profile';
import { useProfileForm } from '../hooks/use-profile-form';
import { ApplySection } from '../sections/apply-section';

vi.mock('@/server/actions/profile', () => ({
  saveProfileAction: vi.fn(async () => ({ ok: true, profileChanged: true })),
  saveProfileMarkdownAction: vi.fn(async () => ({ ok: true })),
}));

// Mirrors src/app/profile/page.tsx's SSR initialData shape — including the
// absence of `apply_answers`, which is what makes useFieldArray's mount sync
// observable.
const INITIAL: ProfileState = {
  candidate: { full_name: 'Alice', email: 'a@b.co' },
  target_roles: { archetypes: [{ name: 'Solutions Engineer', level: 'mid', fit: 'primary' }] },
  narrative: {},
  compensation: { target_range: '$200k' },
  location: {},
  languages: [],
  search: { terms: ['react'], locations: ['Remote'] },
};

function Harness({ initialData }: { initialData: ProfileState }) {
  const { form } = useProfileForm({ initialData });
  return (
    <FormProvider {...form}>
      <ApplySection />
    </FormProvider>
  );
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness initialData={INITIAL} />
    </QueryClientProvider>,
  );
}

describe('Profile auto-save — hydration must not save', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('mount + hydration alone never schedules a save', async () => {
    renderHarness();
    // Well past the 600ms debounce — any scheduled save would have fired.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(saveProfileAction).not.toHaveBeenCalled();
  });

  it('a real edit still auto-saves after the debounce', async () => {
    const { getByText } = renderHarness();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await act(async () => {
      fireEvent.click(getByText('+ Add answer'));
    });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(saveProfileAction).toHaveBeenCalledTimes(1);
  });
});
