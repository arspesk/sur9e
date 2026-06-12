export const runtime = 'nodejs';

import { jsonError, parsePositiveInt } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import {
  CANONICAL_STATUSES,
  deleteApplication,
  findByNum,
  updateStatus,
} from '@/lib/server/applications';

interface Params {
  params: Promise<{ num: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { num: rawNum } = await params;
  const num = parsePositiveInt(rawNum);
  if (!num) return jsonError('num must be an integer', 400);
  const entry = findByNum(ROOT, num);
  if (!entry) return jsonError(`Application #${num} not found`, 404);
  return Response.json(entry);
}

export async function PATCH(request: Request, { params }: Params) {
  const { num: rawNum } = await params;
  const num = parsePositiveInt(rawNum);
  if (!num) return jsonError('invalid num', 400);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.status !== 'string') return jsonError('missing status', 400);
  if (!(CANONICAL_STATUSES as readonly string[]).includes(body.status)) {
    return jsonError(`invalid status: ${body.status}`, 400);
  }
  try {
    const updated = updateStatus(ROOT, num, body.status);
    if (!updated) return jsonError('num not found', 404);
    return Response.json(updated);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to update status';
    if (msg.includes('not found')) return jsonError(msg, 404);
    return jsonError(msg, 500);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { num: rawNum } = await params;
  const num = parsePositiveInt(rawNum);
  if (!num) return jsonError('invalid num', 400);
  try {
    return Response.json(deleteApplication(ROOT, num));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to delete application';
    if (msg.includes('not found')) return jsonError(msg, 404);
    return jsonError(msg, 500);
  }
}
