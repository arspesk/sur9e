export const runtime = 'nodejs';

import { ROOT } from '@/lib/root';
import { listWorkflows } from '@/lib/server/workflows';

export async function GET() {
  return Response.json({ workflows: listWorkflows(ROOT) });
}
