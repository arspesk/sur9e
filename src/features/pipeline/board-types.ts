// Board-shaped types layered atop ApplicationRow so the board
// components can talk in columns without re-deriving every render.

import type { ApplicationStatus } from '@/lib/schemas/applications';

export type ColumnKey = ApplicationStatus;

export interface BoardColumn {
  key: ColumnKey;
  label: string;
}

export const COLUMNS: readonly BoardColumn[] = Object.freeze([
  { key: 'screened', label: 'Screened' },
  { key: 'evaluated', label: 'Evaluated' },
  { key: 'applied', label: 'Applied' },
  { key: 'responded', label: 'Responded' },
  { key: 'interview', label: 'Interview' },
  // "Offer received" (not "Offer") — the app calls every tracked posting an
  // "offer", so the stage label must disambiguate the actual job offer stage.
  { key: 'offer', label: 'Offer received' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'discarded', label: 'Discarded' },
]);
