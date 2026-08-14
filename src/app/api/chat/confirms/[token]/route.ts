export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { ConfirmResolveRequest } from '@/lib/schemas/chat-actions';
import { resolveConfirm } from '@/lib/server/chat/confirms';
import { revalidatePath } from '@/server/revalidate';

interface Params {
  params: Promise<{ token: string }>;
}

// Called by the web UI when the user clicks Approve / Cancel on an
// in-chat confirm card. Execution happens here — outside the model turn.
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = ConfirmResolveRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError('body must be { approve: boolean }', 400);
  }
  const resolved = await resolveConfirm(ROOT, token, parsed.data.approve);
  // An approved offer update may have touched the report (url/body/etc.), the
  // tracker row (company/role/posted), and every surface projecting them.
  if (
    resolved.outcome === 'approved' &&
    resolved.result?.ok === true &&
    'offerUpdate' in resolved.result
  ) {
    revalidatePath('/');
    revalidatePath('/offers');
    revalidatePath('/pipeline');
    revalidatePath('/report/[filename]', 'page');
  }
  if (
    resolved.outcome === 'approved' &&
    resolved.result?.ok === true &&
    'textOffer' in resolved.result
  ) {
    revalidatePath('/offers');
  }
  if (
    resolved.outcome === 'approved' &&
    resolved.result?.ok === true &&
    'updated' in resolved.result
  ) {
    revalidatePath('/');
    revalidatePath('/offers');
    revalidatePath('/pipeline');
    revalidatePath('/report/[filename]', 'page');
  }
  return Response.json(resolved);
}
