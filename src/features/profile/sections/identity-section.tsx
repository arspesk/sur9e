'use client';

import { Globe, Mail, Phone, User } from 'lucide-react';
import { useFormContext } from 'react-hook-form';
import { ErrorText, GithubIcon, Input, Label, LinkedinIcon } from '@/components/primitives';
import type { ProfileFormValues } from '../schemas';

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

// Phone formatting on blur — US (NNN) NNN-NNNN if 10 digits;
// leave anything else as-is so international numbers / extensions survive.
function formatPhoneOnBlur(value: string): string {
  const raw = (value || '').replace(/\D/g, '');
  if (raw.length === 10) {
    return `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`;
  }
  if (raw.length === 11 && raw.startsWith('1')) {
    return `(${raw.slice(1, 4)}) ${raw.slice(4, 7)}-${raw.slice(7)}`;
  }
  return value;
}

export function IdentitySection() {
  const {
    register,
    setValue,
    getValues,
    formState: { errors },
  } = useFormContext<ProfileFormValues>();

  const candidateErrors = errors.candidate as
    | Record<string, { message?: string } | undefined>
    | undefined;

  return (
    <section id="identity" className="form-section anim-enter">
      <h2 className="form-section__title">Identity</h2>
      <p className="form-section__desc">
        Who you are on paper — used in every CV, cover letter, and evaluation.
      </p>
      <div className="form-grid form-grid--cols-2">
        <div className="form-field">
          <Label htmlFor="profile-full-name">
            Full name{' '}
            <span className="form-required" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            invalid={Boolean(candidateErrors?.full_name)}
            id="profile-full-name"
            type="text"
            autoComplete="name"
            aria-required
            aria-describedby={
              candidateErrors?.full_name?.message ? 'profile-full-name-err' : undefined
            }
            data-key="candidate.full_name"
            icon={<User />}
            {...register('candidate.full_name')}
          />
          <ErrorText id="profile-full-name-err">{candidateErrors?.full_name?.message}</ErrorText>
        </div>
        <div className="form-field">
          <Label htmlFor="profile-email">
            Email{' '}
            <span className="form-required" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            invalid={Boolean(candidateErrors?.email)}
            id="profile-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            aria-required
            aria-describedby={candidateErrors?.email?.message ? 'profile-email-err' : undefined}
            data-key="candidate.email"
            icon={<Mail />}
            {...register('candidate.email')}
          />
          <ErrorText id="profile-email-err">{candidateErrors?.email?.message}</ErrorText>
        </div>
        <div className="form-field">
          <Label htmlFor="profile-phone">Phone</Label>
          <Input
            id="profile-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            data-key="candidate.phone"
            icon={<Phone />}
            {...register('candidate.phone', {
              onBlur: () => {
                const raw = asString(getValues('candidate.phone' as keyof ProfileFormValues));
                setValue(
                  'candidate.phone' as keyof ProfileFormValues,
                  formatPhoneOnBlur(raw) as never,
                );
              },
            })}
          />
        </div>
        <div className="form-field">
          <Label htmlFor="profile-github">GitHub</Label>
          <Input
            id="profile-github"
            type="text"
            autoComplete="username"
            spellCheck={false}
            data-key="candidate.github"
            icon={<GithubIcon />}
            {...register('candidate.github')}
          />
          <span className="form-field__hint">Username or full URL — both work.</span>
        </div>
        <div className="form-field form-field--full">
          <Label htmlFor="profile-linkedin">LinkedIn</Label>
          <Input
            id="profile-linkedin"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            data-key="candidate.linkedin"
            icon={<LinkedinIcon />}
            {...register('candidate.linkedin')}
          />
        </div>
        <div className="form-field form-field--full">
          <Label htmlFor="profile-portfolio-url">Portfolio URL</Label>
          <Input
            id="profile-portfolio-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            data-key="candidate.portfolio_url"
            icon={<Globe />}
            {...register('candidate.portfolio_url')}
          />
        </div>
      </div>
    </section>
  );
}
