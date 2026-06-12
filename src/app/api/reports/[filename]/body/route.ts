// src/app/api/reports/[filename]/body/route.ts
import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { isFrontmatterFormat, parseFrontmatter, saveReport } from '@/lib/server/reports';
import { revalidatePath } from '@/server/revalidate';

const REPORTS_DIR = 'artifacts/reports';

export async function PATCH(req: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  const safe = filename.replace(/[^a-z0-9._-]/gi, '');
  const filePath = join(process.cwd(), REPORTS_DIR, safe);
  const json = (await req.json().catch(() => null)) as { body?: string } | null;
  if (!json || typeof json.body !== 'string') {
    return NextResponse.json({ error: 'body must be string' }, { status: 400 });
  }
  let current: string;
  try {
    current = readFileSync(filePath, 'utf8');
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (!isFrontmatterFormat(current)) {
    return NextResponse.json({ error: 'legacy format — migrate first' }, { status: 409 });
  }
  const { frontmatter } = parseFrontmatter(current);
  // Whole-body save — the /report page and the offers drawer share the same
  // full-body editor, so the request body IS the next on-disk body.
  const nextBody = json.body;
  saveReport({ filePath, frontmatter, body: nextBody });
  revalidatePath(`/report/${safe}`);
  revalidatePath('/offers');
  return NextResponse.json({ ok: true });
}
