// src/app/api/output/inline/route.ts
//
// POST /api/output/inline — accepts a multipart upload from the editor's
// image slash-item (see slash-items-basic.ts → "Image"). Writes the file
// under artifacts/output/inline/<uuid>-<safe-name> and returns a JSON
// `{ url }` pointing at the GET-side sibling route below. 5MB cap.
//
// Companion read route lives at ./[filename]/route.ts and serves the
// uploaded bytes with the correct content-type via the mime-types lookup.
// This split is deliberate so the dynamic [filename] segment never collides
// with the existing /api/output/[...path] GET handler (different parent).

import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { inlineImageMimeForName, isAllowedInlineImageMime } from '@/lib/server/inline-uploads';

export const runtime = 'nodejs';

const DEST_DIR = 'artifacts/output/inline';
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no file' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'too large' }, { status: 413 });
  }
  // Only raster images, validated by BOTH declared MIME and extension. Blocks
  // storing an .html/.svg that the GET sibling could later serve same-origin
  // (stored XSS). The editor client already filters to image/* — this is the
  // server-side guarantee.
  if (!isAllowedInlineImageMime(file.type) || !inlineImageMimeForName(file.name)) {
    return NextResponse.json({ error: 'unsupported file type' }, { status: 415 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const safe = file.name.replace(/[^a-z0-9._-]/gi, '_');
  const filename = `${randomUUID()}-${safe}`;
  mkdirSync(join(process.cwd(), DEST_DIR), { recursive: true });
  writeFileSync(join(process.cwd(), DEST_DIR, filename), buf);
  return NextResponse.json({ url: `/api/output/inline/${filename}` });
}
