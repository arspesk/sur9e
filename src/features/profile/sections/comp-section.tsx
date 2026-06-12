'use client';

import { DollarSign } from 'lucide-react';
import { Controller, useFormContext } from 'react-hook-form';
import {
  ErrorText,
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@/components/primitives';
import type { ProfileFormValues } from '../schemas';

const FIELD_HELP: Record<string, string> = {
  'compensation.acceptable_floor': "Total comp below which you'd walk away.",
  'compensation.minimum': 'Base salary minimum (separate from OTE).',
  'compensation.target_range': 'Base + variable narrative (e.g. "$220K-260K OTE").',
};

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF'];

export function CompSection() {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<ProfileFormValues>();

  const compErrors = errors.compensation as
    | Record<string, { message?: string } | undefined>
    | undefined;

  return (
    <section id="comp" className="form-section anim-enter">
      <h2 className="form-section__title">Compensation</h2>
      <p className="form-section__desc">Your target band and the floor you won&apos;t go under.</p>
      <div className="form-grid form-grid--cols-2">
        <div className="form-field">
          <Label htmlFor="profile-comp-target-range">
            Target range{' '}
            <span className="form-required" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            invalid={Boolean(compErrors?.target_range)}
            id="profile-comp-target-range"
            type="text"
            autoComplete="off"
            aria-required
            data-key="compensation.target_range"
            icon={<DollarSign />}
            {...register('compensation.target_range')}
          />
          <ErrorText>{compErrors?.target_range?.message}</ErrorText>
          <HelperText>{FIELD_HELP['compensation.target_range']}</HelperText>
        </div>
        <div className="form-field">
          <Label htmlFor="profile-comp-currency">Currency</Label>
          <Controller
            name={'compensation.currency' as never}
            control={control}
            render={({ field }) => {
              const currentValue = typeof field.value === 'string' ? field.value : '';
              return (
                <Select value={currentValue || undefined} onValueChange={v => field.onChange(v)}>
                  <SelectTrigger
                    id="profile-comp-currency"
                    data-key="compensation.currency"
                    ref={field.ref}
                    onBlur={field.onBlur}
                    disabled={field.disabled}
                  >
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            }}
          />
        </div>
        <div className="form-field">
          <Label htmlFor="profile-comp-minimum">Minimum</Label>
          <Input
            id="profile-comp-minimum"
            type="text"
            autoComplete="off"
            placeholder="e.g. $120K"
            data-key="compensation.minimum"
            icon={<DollarSign />}
            {...register('compensation.minimum')}
          />
          <HelperText>{FIELD_HELP['compensation.minimum']}</HelperText>
        </div>
        <div className="form-field">
          <Label htmlFor="profile-comp-acceptable-floor">Acceptable floor</Label>
          <Input
            id="profile-comp-acceptable-floor"
            type="text"
            autoComplete="off"
            placeholder="e.g. $90K"
            data-key="compensation.acceptable_floor"
            icon={<DollarSign />}
            {...register('compensation.acceptable_floor')}
          />
          <HelperText>{FIELD_HELP['compensation.acceptable_floor']}</HelperText>
        </div>
        <div className="form-field form-field--full">
          <Label htmlFor="profile-comp-notes">Notes</Label>
          <Textarea
            id="profile-comp-notes"
            data-key="compensation.notes"
            {...register('compensation.notes')}
          />
        </div>
      </div>
    </section>
  );
}
