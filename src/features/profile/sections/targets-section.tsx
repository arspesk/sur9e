'use client';

// sections/targets-section.tsx
// Fields:
//   - target_roles.archetypes (rowlist) — primary/secondary archetypes
//   - target_roles.preferred_yoe (text) — drives the `seniority` axis in both
//     the Haiku screener and the Sonnet evaluator
//   - search.terms (chiplist) — JobSpy query keywords

import { useFormContext } from 'react-hook-form';
import { HelperText, Input, Label } from '@/components/primitives';
import type { ProfileFormValues } from '../schemas';
import { ControlledChipList } from './_widgets/controlled-chip-list';
import { ControlledRowList } from './_widgets/controlled-row-list';

export function TargetsSection() {
  const { register } = useFormContext<ProfileFormValues>();

  return (
    <section id="targets" className="form-section anim-enter">
      <h2 className="form-section__title">Target roles</h2>
      <p className="form-section__desc">
        The roles you&apos;re hunting — archetypes and seniority drive every match score.
      </p>
      <div className="form-grid">
        <div className="form-field" role="group" aria-labelledby="profile-archetypes-label">
          <Label as="span" id="profile-archetypes-label">
            Archetypes{' '}
            <span className="form-required" aria-hidden="true">
              *
            </span>
          </Label>
          <ControlledRowList<ProfileFormValues, 'target_roles.archetypes', Record<string, string>>
            name="target_roles.archetypes"
            kind="archetype"
            cols={['name', 'level', 'fit'] as const}
            newRow={() => ({ name: '', level: '', fit: '' })}
            addLabel="+ Add archetype"
          />
        </div>

        <div className="form-field">
          <Label htmlFor="profile-preferred-yoe">Preferred years of experience</Label>
          <Input
            id="profile-preferred-yoe"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder='e.g. "2-3", "5-7", or "any"'
            {...register('target_roles.preferred_yoe')}
          />
          <HelperText>
            Drives the <strong>seniority</strong> score axis. Roles inside this band score 4.5-5.0;
            roles further from it scale down progressively. Leave blank or set to <code>any</code>{' '}
            for neutral scoring.
          </HelperText>
        </div>

        <div className="form-field">
          <Label htmlFor="profile-search-terms-add">
            Search keywords{' '}
            <span className="form-required" aria-hidden="true">
              *
            </span>
          </Label>
          <ControlledChipList<ProfileFormValues, 'search.terms'>
            name="search.terms"
            inputId="profile-search-terms-add"
            inputPlaceholder="Add a keyword and press Enter"
            hint="Each keyword runs a separate JobSpy search; results are merged."
          />
        </div>
      </div>
    </section>
  );
}
