export const runtime = 'nodejs';

import { serveFromDir } from '@/lib/api/static-proxy';

interface Params {
  params: Promise<{ path: string[] }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { path } = await params;
  return serveFromDir('artifacts/outreach', path);
}
