'use client';

// sections/screening-section.tsx — batch-screening knobs in one place:
// test limit, score threshold, parallel workers, per-offer timeout.
// Section ID: "screening" (legacy anchor). The former #filtering and
// #screening-perf sections were merged in here; invisible anchor aliases
// below keep old deep links landing on this section.

import { useFormContext } from 'react-hook-form';
import { HelperText, Input, Label } from '@/components/primitives';
import type { SettingsFormValues } from '../types';

export function ScreeningSection() {
  const { register } = useFormContext<SettingsFormValues>();

  return (
    <section className="form-section anim-enter" id="screening">
      {/* Invisible aliases for retired deep links (#filtering, #screening-perf).
          Zero-size spans with the same scroll-margin as a section anchor so
          jumps clear the sticky topbar and land on this section's title. */}
      <span id="filtering" className="settings-anchor-alias" aria-hidden="true" />
      <span id="screening-perf" className="settings-anchor-alias" aria-hidden="true" />
      <h2 className="form-section__title">Screening</h2>
      <p className="form-section__desc">
        How batch screening runs — test-run size, score gate, and worker tuning. Stored in{' '}
        <code>inputs/config/config.yml</code> under <code>screening.*</code> and{' '}
        <code>advanced.*</code>.
      </p>
      <div className="form-grid form-grid--cols-2">
        <div className="form-field">
          <Label htmlFor="smokeLimit">Limit</Label>
          <Input
            type="number"
            id="smokeLimit"
            inputMode="numeric"
            autoComplete="off"
            min={0}
            step={1}
            {...register('screening.smoke_test_limit', { valueAsNumber: true })}
          />
          <HelperText>
            Max screenings for offers per scan run. <code>0</code> = unlimited.
          </HelperText>
        </div>
        <div className="form-field">
          <Label htmlFor="settings-score-threshold">Score threshold</Label>
          <Input
            id="settings-score-threshold"
            type="number"
            inputMode="decimal"
            autoComplete="off"
            min={0}
            max={5}
            step={0.1}
            data-adv-num="score_threshold"
            {...register('advanced.score_threshold', { valueAsNumber: true })}
          />
          <HelperText>
            Offers below this score are ignored on merge and skipped by Batch Evaluate.{' '}
            <code>0</code> disables.
          </HelperText>
        </div>
        <div className="form-field">
          <Label htmlFor="settings-screening-workers">Parallel workers</Label>
          <Input
            id="settings-screening-workers"
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={1}
            step={1}
            data-adv-int="parallel_workers"
            {...register('advanced.parallel_workers', { valueAsNumber: true })}
          />
          <HelperText>Concurrent screening workers per scan.</HelperText>
        </div>
        <div className="form-field">
          <Label htmlFor="settings-screening-timeout">Timeout (ms)</Label>
          <Input
            id="settings-screening-timeout"
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={1000}
            step={1000}
            data-adv-int="timeout_ms"
            {...register('advanced.timeout_ms', { valueAsNumber: true })}
          />
          <HelperText>Per-URL screening worker timeout (ms).</HelperText>
        </div>
      </div>
    </section>
  );
}
