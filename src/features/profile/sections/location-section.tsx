'use client';

import { Globe, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import {
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/primitives';
import type { ProfileFormValues } from '../schemas';
import { ControlledChipList } from './_widgets/controlled-chip-list';
import { ControlledRowList } from './_widgets/controlled-row-list';

// Timezone groups — curated list of common IANA zones grouped by region.
const TZ_GROUPS: Array<[string, string[]]> = [
  [
    'Americas',
    [
      'America/Los_Angeles',
      'America/Denver',
      'America/Phoenix',
      'America/Chicago',
      'America/New_York',
      'America/Halifax',
      'America/St_Johns',
      'America/Mexico_City',
      'America/Bogota',
      'America/Lima',
      'America/Caracas',
      'America/Santiago',
      'America/Sao_Paulo',
      'America/Argentina/Buenos_Aires',
      'America/Anchorage',
    ],
  ],
  [
    'Europe',
    [
      'Europe/London',
      'Europe/Dublin',
      'Europe/Lisbon',
      'Europe/Madrid',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Amsterdam',
      'Europe/Brussels',
      'Europe/Zurich',
      'Europe/Rome',
      'Europe/Stockholm',
      'Europe/Oslo',
      'Europe/Copenhagen',
      'Europe/Warsaw',
      'Europe/Prague',
      'Europe/Vienna',
      'Europe/Athens',
      'Europe/Helsinki',
      'Europe/Bucharest',
      'Europe/Istanbul',
      'Europe/Moscow',
    ],
  ],
  [
    'Africa',
    ['Africa/Casablanca', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Nairobi', 'Africa/Johannesburg'],
  ],
  ['Middle East', ['Asia/Jerusalem', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Tehran']],
  [
    'Asia / South',
    ['Asia/Karachi', 'Asia/Kolkata', 'Asia/Colombo', 'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Yangon'],
  ],
  [
    'Asia / SE',
    [
      'Asia/Bangkok',
      'Asia/Jakarta',
      'Asia/Singapore',
      'Asia/Kuala_Lumpur',
      'Asia/Manila',
      'Asia/Ho_Chi_Minh',
    ],
  ],
  ['Asia / East', ['Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Seoul']],
  [
    'Oceania',
    [
      'Australia/Perth',
      'Australia/Adelaide',
      'Australia/Brisbane',
      'Australia/Sydney',
      'Australia/Melbourne',
      'Pacific/Auckland',
      'Pacific/Fiji',
      'Pacific/Honolulu',
    ],
  ],
  ['UTC', ['UTC']],
];

// Radix Select forbids empty-string item values, so we translate "" <-> NONE
// at the consumer boundary. rhf state still sees "" for the cleared state,
// preserving the legacy data contract.
const NONE = '__none__';

function formatTzLabel(tz: string): string {
  try {
    const now = new Date();
    const partsAbbr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(now);
    const partsUtc = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    }).formatToParts(now);
    const abbr = partsAbbr.find(p => p.type === 'timeZoneName')?.value || '';
    const utc = partsUtc.find(p => p.type === 'timeZoneName')?.value || '';
    return `${tz} — ${abbr} (${utc})`;
  } catch {
    return tz;
  }
}

export function LocationSection() {
  const { register, control, watch, setValue } = useFormContext<ProfileFormValues>();

  const onsiteAvailability = watch('location.onsite_availability' as keyof ProfileFormValues) as
    | string
    | undefined;
  const locationFlexibility = watch('location.location_flexibility' as keyof ProfileFormValues) as
    | string
    | undefined;

  const tzOptions = useMemo(
    () =>
      TZ_GROUPS.map(([group, tzs]) => ({
        group,
        items: tzs.map(tz => ({ value: tz, label: formatTzLabel(tz) })),
      })),
    [],
  );

  function toggleSegmented(
    field: 'location.onsite_availability' | 'location.location_flexibility',
    value: string,
    current: string | undefined,
  ) {
    // Toggle off on same click (mirrors legacy UX).
    setValue(field as keyof ProfileFormValues, (current === value ? '' : value) as never);
  }

  const ONSITE_LABELS: Record<string, string> = {
    remote: 'Remote',
    hybrid: 'Hybrid',
    onsite: 'On-site',
    open: 'Open',
  };

  const FLEX_LABELS: Record<string, string> = {
    strict: 'Strict',
    flexible: 'Flexible',
    open: 'Open',
  };

  return (
    <section id="location" className="form-section anim-enter">
      <h2 className="form-section__title">Location</h2>
      <p className="form-section__desc">
        Where you are and where you can work — drives every location match.
      </p>
      <div className="form-grid form-grid--cols-2">
        <div className="form-field">
          <Label htmlFor="profile-loc-country">Country</Label>
          <Input
            id="profile-loc-country"
            type="text"
            autoComplete="country-name"
            data-key="location.country"
            icon={<Globe />}
            {...register('location.country')}
          />
        </div>
        <div className="form-field">
          <Label htmlFor="profile-loc-city">City</Label>
          <Input
            id="profile-loc-city"
            type="text"
            autoComplete="address-level2"
            data-key="location.city"
            icon={<MapPin />}
            {...register('location.city')}
          />
        </div>
        <div className="form-field">
          <Label htmlFor="profile-loc-timezone">Timezone</Label>
          <Controller
            name="location.timezone"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value ? field.value : NONE}
                onValueChange={v => field.onChange(v === NONE ? '' : v)}
              >
                <SelectTrigger
                  id="profile-loc-timezone"
                  data-key="location.timezone"
                  data-tz-select="1"
                  ref={field.ref}
                  onBlur={field.onBlur}
                  disabled={field.disabled}
                >
                  <SelectValue placeholder="— Select… —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Select… —</SelectItem>
                  {tzOptions.map(g => (
                    <SelectGroup key={g.group}>
                      <SelectLabel>{g.group}</SelectLabel>
                      {g.items.map(t => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <HelperText>IANA TZ (e.g. &quot;America/Los_Angeles&quot;)</HelperText>
        </div>
        <div className="form-field">
          <Label htmlFor="profile-loc-visa-status">Visa status</Label>
          <Controller
            name="location.visa_status"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value ? field.value : NONE}
                onValueChange={v => field.onChange(v === NONE ? '' : v)}
              >
                <SelectTrigger
                  id="profile-loc-visa-status"
                  data-key="location.visa_status"
                  ref={field.ref}
                  onBlur={field.onBlur}
                  disabled={field.disabled}
                >
                  <SelectValue placeholder="— Select… —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Select… —</SelectItem>
                  <SelectItem value="citizen">Citizen</SelectItem>
                  <SelectItem value="green-card">Green card</SelectItem>
                  <SelectItem value="h1b">H1B</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="form-field form-field--full">
          <Label as="span" id="profile-loc-onsite-label">
            On-site availability
          </Label>
          <div
            className="form-segmented"
            data-segmented="location.onsite_availability"
            role="radiogroup"
            aria-labelledby="profile-loc-onsite-label"
          >
            {(['remote', 'hybrid', 'onsite', 'open'] as const).map(v => {
              const active = onsiteAvailability === v;
              return (
                <button
                  key={v}
                  className={`form-segmented__option${active ? ' is-active' : ''}`}
                  data-value={v}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() =>
                    toggleSegmented('location.onsite_availability', v, onsiteAvailability)
                  }
                >
                  {ONSITE_LABELS[v] ?? v}
                </button>
              );
            })}
          </div>
          <HelperText>
            <strong>Remote</strong> = JobSpy filters every query to remote-tagged jobs only.{' '}
            <strong>Hybrid / On-site / Open</strong> = JobSpy returns all work modes within your
            search locations.
          </HelperText>
        </div>
        <div className="form-field form-field--full">
          <Label as="span" id="profile-loc-flex-label">
            Location flexibility
          </Label>
          <div
            className="form-segmented"
            data-segmented="location.location_flexibility"
            role="radiogroup"
            aria-labelledby="profile-loc-flex-label"
          >
            {(['strict', 'flexible', 'open'] as const).map(v => {
              const active = locationFlexibility === v;
              return (
                <button
                  key={v}
                  className={`form-segmented__option${active ? ' is-active' : ''}`}
                  data-value={v}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() =>
                    toggleSegmented('location.location_flexibility', v, locationFlexibility)
                  }
                >
                  {FLEX_LABELS[v] ?? v}
                </button>
              );
            })}
          </div>
          <HelperText>
            <strong>Strict / Flexible</strong> = JobSpy queries only the locations listed below.{' '}
            <strong>Open</strong> = JobSpy also adds a country-wide remote-only query (broadens to
            remote-anywhere-in-country without pulling onsite-elsewhere noise).
          </HelperText>
        </div>
        <div
          className="form-field form-field--full"
          role="group"
          aria-labelledby="profile-languages-label"
        >
          <Label as="span" id="profile-languages-label">
            Languages
          </Label>
          <ControlledRowList<ProfileFormValues, 'languages', Record<string, string>>
            name="languages"
            kind="language"
            cols={['name', 'proficiency'] as const}
            newRow={() => ({ name: '', proficiency: '' })}
            addLabel="+ Add language"
          />
        </div>
        <div className="form-field form-field--full">
          <Label htmlFor="profile-search-locations-add">
            Search locations{' '}
            <span className="form-required" aria-hidden="true">
              *
            </span>
          </Label>
          <ControlledChipList<ProfileFormValues, 'search.locations'>
            name="search.locations"
            inputId="profile-search-locations-add"
            inputPlaceholder="Add a location and press Enter (e.g. Los Angeles, CA)"
            hint="JobSpy runs one query per location. The work-mode filter is set by On-site availability above."
          />
        </div>
      </div>
    </section>
  );
}
