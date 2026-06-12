export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { loadReport } from '@/lib/server/reports';

interface Params {
  params: Promise<{ filename: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { filename } = await params;
  try {
    const r = loadReport(ROOT, filename);
    const err = (r as { error?: string }).error;
    if (err) {
      // Return only the sanitized message — never echo the internal envelope,
      // which can carry an absolute on-disk path (info disclosure).
      return Response.json({ error: err }, { status: 404 });
    }
    return Response.json(r);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load report');
  }
}
