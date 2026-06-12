// src/app/api/output/inline/[filename]/route.ts
//
// GET /api/output/inline/<filename> — serves bytes uploaded via the sibling
// POST handler (../route.ts). The content-type is forced from a raster-image
// allowlist (never the raw extension), defaulting to application/octet-stream,
// so an attacker who slipped a .html/.svg past the upload guard can't get it
// served as executable same-origin content. `nosniff` + a sandbox CSP are sent
// as belt-and-suspenders against content-type sniffing / script execution. The
// filename param is sanitized to the same character set the POST handler uses.

import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { inlineImageMimeForName } from '@/lib/server/inline-uploads';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  const safe = filename.replace(/[^a-z0-9._-]/gi, '');
  if (!safe) {
    return NextResponse.json({ error: 'bad filename' }, { status: 400 });
  }
  let buf: Buffer;
  try {
    buf = readFileSync(join(process.cwd(), 'artifacts/output/inline', safe));
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type': inlineImageMimeForName(safe) ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    },
  });
}
