export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { activeJobsByType } from '@/lib/server/jobs';

// Every job kind: offer-scoped (with num) for job locks + deck discovery,
// system kinds (num-less) for the deck discovery poll. Cards surface for
// scheduler/CLI/API-started runs in any open tab, not just tab-started ones.
const ACTIVE_JOB_TYPES = [
  'evaluate',
  'tailor-cv',
  'cover-letter',
  'research',
  'interview-prep',
  'reach-out',
  'negotiate',
  'scan',
  'batch-evaluate',
  'screen',
  'screen-evaluate',
];

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('types') ?? ACTIVE_JOB_TYPES.join(',');
  const requested = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const allowed = requested
    .map(t => (t === 'outreach' ? 'reach-out' : t))
    .filter(t => ACTIVE_JOB_TYPES.includes(t));
  if (allowed.length === 0) {
    return jsonError(`unknown types: ${raw}`, 400);
  }
  return Response.json(activeJobsByType(ROOT, allowed));
}
