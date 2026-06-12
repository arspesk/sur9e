'use client';

// Shared scan-source enable toggle — used by the ATS portals and JobSpy
// sections. Both flags live in the same settings rhf form even though the
// toggles render in different sections, so the "at least one source must
// stay enabled" guard reads the sibling's live value via watch: switching
// the last enabled source off is refused and the error line explains why.

import { type ReactNode, useEffect, useState } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { ErrorText, HelperText } from '@/components/primitives';
import type { SettingsFormValues } from '../types';

type SourcePath = 'scanning.sources.ats' | 'scanning.sources.jobspy';

interface SourceToggleProps {
  /** rhf path of THIS source's flag. */
  name: SourcePath;
  /** rhf path of the sibling source — it must stay on for this one to turn off. */
  siblingName: SourcePath;
  id: string;
  label: string;
  /** Optional one-line source description rendered under the toggle. */
  children?: ReactNode;
}

export function SourceToggle({ name, siblingName, id, label, children }: SourceToggleProps) {
  const { control, watch } = useFormContext<SettingsFormValues>();
  const siblingEnabled = watch(siblingName);
  const [refused, setRefused] = useState(false);

  // The refusal only holds while the sibling is off — once it's re-enabled
  // (possibly from the other section), the stale error would be wrong.
  useEffect(() => {
    if (siblingEnabled) setRefused(false);
  }, [siblingEnabled]);

  return (
    <div className="form-field source-toggle">
      <label className="schedule-toggle">
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <input
              type="checkbox"
              id={id}
              checked={field.value}
              aria-describedby={refused ? `${id}-err` : undefined}
              onChange={e => {
                const next = e.target.checked;
                // Refuse switching the last enabled source off.
                if (!next && !siblingEnabled) {
                  setRefused(true);
                  return;
                }
                setRefused(false);
                field.onChange(next);
              }}
              className="schedule-toggle__input"
            />
          )}
        />
        <span className="schedule-toggle__label">{label}</span>
      </label>
      {refused && <ErrorText id={`${id}-err`}>At least one source must stay enabled.</ErrorText>}
      {children != null && <HelperText>{children}</HelperText>}
    </div>
  );
}
