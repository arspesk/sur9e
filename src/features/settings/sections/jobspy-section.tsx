'use client';

// JobSpy section: the job-board scraper's enable toggle + crawler knobs.
// Moved out of "Job scanning" so each scan source owns its settings; the
// shared queue + schedule machinery stays in scanning-section.
// Section ID: "jobspy".

import { useFormContext } from 'react-hook-form';
import { HelperText, Input, Label } from '@/components/primitives';
import { cn } from '@/lib/cn';
import type { SettingsFormValues } from '../types';
import { SourceToggle } from './source-toggle';

export function JobspySection() {
  const { register, watch } = useFormContext<SettingsFormValues>();
  const jobspyEnabled = watch('scanning.sources.jobspy');

  return (
    <section className="form-section anim-enter" id="jobspy">
      <h2 className="form-section__title">JobSpy</h2>
      <p className="form-section__desc">
        The job-board scraper — toggle the source and tune its search window and volume.
      </p>

      <SourceToggle
        name="scanning.sources.jobspy"
        siblingName="scanning.sources.ats"
        id="settings-source-jobspy"
        label="Enable JobSpy scanning"
      />

      {/* Crawler knobs — disabled + dimmed while the source is off, mirroring
          how the ATS company manager de-emphasizes when ATS is disabled. */}
      <div
        className={cn('form-grid form-grid--cols-2', !jobspyEnabled && 'portal-manager--dimmed')}
      >
        <div className="form-field">
          <Label htmlFor="settings-jobspy-hours">Hours old</Label>
          <Input
            id="settings-jobspy-hours"
            type="number"
            inputMode="numeric"
            autoComplete="off"
            data-key-int="scanning.jobspy.hours_old"
            min={1}
            step={1}
            placeholder="168"
            disabled={!jobspyEnabled}
            {...register('scanning.jobspy.hours_old', { valueAsNumber: true })}
          />
          <HelperText>Only return offers posted in the last N hours.</HelperText>
        </div>
        <div className="form-field">
          <Label htmlFor="settings-jobspy-results">Results wanted</Label>
          <Input
            id="settings-jobspy-results"
            type="number"
            inputMode="numeric"
            autoComplete="off"
            data-key-int="scanning.jobspy.results_wanted"
            min={1}
            step={1}
            placeholder="1000"
            disabled={!jobspyEnabled}
            {...register('scanning.jobspy.results_wanted', { valueAsNumber: true })}
          />
          <HelperText>Max offers per scan run.</HelperText>
        </div>
      </div>
    </section>
  );
}
