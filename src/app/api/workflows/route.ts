export const runtime = 'nodejs';

import { ROOT } from '@/lib/root';
import { reconcileWorkflows } from '@/lib/server/workflows';

export async function GET() {
  return Response.json({ workflows: reconcileWorkflows(ROOT) });
}
