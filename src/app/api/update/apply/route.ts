export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { rejectCrossOrigin } from '@/lib/server/same-origin';
import { parseUpdateApplyBody, resolveUpdateLaunchMode } from '@/lib/server/update-api';
import { startUpdateJob } from '@/lib/server/update-orchestrator';
import packageJson from '../../../../../package.json';

export async function POST(request: Request) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;

  const body = await parseUpdateApplyBody(request);
  if (!body) return jsonError('Invalid request body', 400);

  try {
    const result = await startUpdateJob(ROOT, {
      mode: resolveUpdateLaunchMode(request),
      fromVersion: packageJson.version,
      ...(body.toVersion === undefined ? {} : { toVersion: body.toVersion }),
    });
    if (result.status === 'started') {
      return Response.json({ jobId: result.job.id }, { status: 202 });
    }
    if (result.status === 'busy') {
      return Response.json(
        {
          error: 'An update is already running',
          ...(result.job ? { jobId: result.job.id } : {}),
        },
        { status: 409 },
      );
    }
    return jsonError('Failed to start update', 500);
  } catch {
    return jsonError('Failed to start update', 500);
  }
}
