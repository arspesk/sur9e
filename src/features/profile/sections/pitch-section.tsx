'use client';

// sections/pitch-section.tsx
// Fields: narrative.headline (text), narrative.exit_story (textarea),
//         narrative.superpowers (chiplist), narrative.proof_points (rowlist)

import { useFormContext } from 'react-hook-form';
import { Input, Label, Textarea } from '@/components/primitives';
import type { ProfileFormValues } from '../schemas';
import { ControlledChipList } from './_widgets/controlled-chip-list';
import { ControlledRowList } from './_widgets/controlled-row-list';

export function PitchSection() {
  const { register } = useFormContext<ProfileFormValues>();

  return (
    <section id="pitch" className="form-section anim-enter">
      <h2 className="form-section__title">Pitch</h2>
      <p className="form-section__desc">
        Your positioning in two sentences — the seed for every cover letter.
      </p>
      <div className="form-grid">
        <div className="form-field">
          <Label htmlFor="profile-headline">Professional headline</Label>
          <Input
            id="profile-headline"
            type="text"
            autoComplete="organization-title"
            data-key="narrative.headline"
            {...register('narrative.headline')}
          />
        </div>
        <div className="form-field">
          <Label htmlFor="profile-exit-story">Exit story</Label>
          <Textarea
            id="profile-exit-story"
            rows={5}
            data-key="narrative.exit_story"
            {...register('narrative.exit_story')}
          />
        </div>
        <div className="form-field">
          <Label htmlFor="profile-superpowers-add">Superpowers</Label>
          <ControlledChipList<ProfileFormValues, 'narrative.superpowers'>
            name="narrative.superpowers"
            inputId="profile-superpowers-add"
            inputPlaceholder="Add a superpower and press Enter"
          />
        </div>
        <div className="form-field" role="group" aria-labelledby="profile-proof-points-label">
          <Label as="span" id="profile-proof-points-label">
            Proof points
          </Label>
          <ControlledRowList<ProfileFormValues, 'narrative.proof_points', Record<string, string>>
            name="narrative.proof_points"
            kind="proof_point"
            cols={['name', 'url', 'hero_metric'] as const}
            newRow={() => ({ name: '', url: '', hero_metric: '' })}
            addLabel="+ Add proof point"
          />
        </div>
      </div>
    </section>
  );
}
