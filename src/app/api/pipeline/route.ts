export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { loadPipeline } from '@/lib/server/pipeline';

export function GET() {
  try {
    return Response.json(loadPipeline(ROOT));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load pipeline');
  }
}
