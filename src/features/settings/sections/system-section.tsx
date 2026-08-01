'use client';

// sections/system-section.tsx — Updates & about (merged system + about)
// Section ID: "system" (single anchor; former "about" id removed)
//
// The About content is not form data — version + update controls go
// through the useSystem hooks (TanStack Query/Mutation per the CLAUDE.md
// client-read rule); only the update source/branch inputs are rhf-managed.

import { useCallback } from 'react';
import { useFormContext } from 'react-hook-form';
import { Button, HelperText, Input, Label } from '@/components/primitives';
import { useToastStore } from '@/components/toast/toast-store';
import { useRollback, useUpdateCheck, useVersion } from '@/hooks/use-system';
import type { SettingsFormValues } from '../types';

type ToneFn = (tone: 'info' | 'success' | 'warning' | 'danger', message: string) => void;

export function SystemSection() {
  const { register, getValues } = useFormContext<SettingsFormValues>();
  const pushToast = useToastStore(s => s.push) as ToneFn;

  const versionQuery = useVersion();
  const version = versionQuery.isPending ? '…' : (versionQuery.data?.version ?? '?');

  const updateCheck = useUpdateCheck();
  const checkUpdates = useCallback(async () => {
    try {
      const r = await updateCheck.mutateAsync();
      const STATUS_LABEL: Record<string, string> = {
        'update-available':
          'Update available — run "npm run update:apply" or ask your agent to update sur9e',
        'up-to-date': 'You are up to date',
        dismissed: 'Update check dismissed',
        offline: 'Could not reach the update server',
      };
      pushToast?.('info', STATUS_LABEL[r?.status ?? ''] || r?.status || 'Check complete');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast?.('danger', `Update check failed (${msg}) — try again later.`);
    }
  }, [pushToast, updateCheck]);

  const rollbackMutation = useRollback();
  const rollback = useCallback(async () => {
    const w = window as unknown as {
      deleteConfirmModal?: {
        confirm: (opts: Record<string, unknown>) => Promise<boolean>;
      };
    };
    const ok = w.deleteConfirmModal
      ? await w.deleteConfirmModal.confirm({
          title: 'Roll back to the previous version?',
          target: 'sur9e installation',
          bodyText:
            'Replaces the current install with the previous version. Your data (CV, profile, tracker, reports) is not touched.',
          warningText: 'Active background jobs may need to be re-run.',
          confirmLabel: 'Roll back',
        })
      : window.confirm(
          'Roll back sur9e to the previous installed version?\nYour data (CV, profile, tracker, reports) will not be touched.',
        );
    if (!ok) return;
    try {
      const r = await rollbackMutation.mutateAsync();
      pushToast?.(
        r?.ok ? 'success' : 'danger',
        r?.ok
          ? 'Rolled back to the previous version'
          : `Rollback failed (${r?.error || 'unknown'}) — see logs.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast?.('danger', `Rollback failed (${msg}) — see logs.`);
    }
  }, [pushToast, rollbackMutation]);

  // Derive about source from rhf (reads current form value, not legacy ref)
  const aboutSource = getValues('system.update_source') ?? '?';

  return (
    <section className="form-section anim-enter" id="system">
      <h2 className="form-section__title">Updates &amp; about</h2>
      <p className="form-section__desc">
        Which repo and branch update checks pull from — point at a fork to track your own builds.
        Stored in <code>system.*</code>.
      </p>
      <div className="form-grid form-grid--cols-2">
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
      <p className="form-section__desc">
        Version{' '}
        <span id="aboutVersion" aria-live="polite">
          {version}
        </span>{' '}
        · Source{' '}
        <code id="aboutSource" translate="no" aria-live="polite">
          {aboutSource}
        </code>
      </p>
      <div className="settings-actions">
        <Button variant="secondary" id="checkUpdates" onClick={checkUpdates}>
          Check for updates
        </Button>
        <Button
          variant="secondary"
          id="rollback"
          title="Roll back to the previous installed version (asks to confirm)"
          onClick={rollback}
        >
          Roll back
        </Button>
      </div>
    </section>
  );
}
