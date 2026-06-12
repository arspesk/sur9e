import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReportPage } from '@/features/report/report-page';
import { type ApplicationEntry, numFromFilename } from '@/features/report/report-types';
import { ROOT } from '@/lib/root';
import { findByFilename, findByNum } from '@/lib/server/applications';

interface PageProps {
  params: Promise<{ filename: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { filename } = await params;
  const decoded = decodeURIComponent(filename);
  try {
    const entry = findByFilename(ROOT, decoded);
    if (entry) {
      return {
        title: `Sur9e — ${entry.company}`,
        description: `${entry.role} at ${entry.company}`,
      };
    }
  } catch {
    // Missing or malformed applications.md — fall back to generic title.
  }
  return { title: 'Sur9e — Offer Report' };
}

// force-dynamic dropped. report-render.tsx no longer
// rewrites the DOM imperatively (the renderer is JSX now); the report
// page can render as a regular server component and let the client
// hydrate from initialEntry. The page is still ƒ (dynamic) at runtime
// because findByNum reads applications.md per-request -- Next can't
// statically prerender that without caching the file. That's fine; the
// per-route render cost is the same, but we no longer block streaming.
//
// DEFERRED: experimental_ppr opt-in removed when next.config
// rolled back the broken `experimental.ppr` API (Next 16.2.6 merged PPR into
// `cacheComponents` with different semantics). Route stays dynamic without
// the flag; revisit once cacheComponents is wired.

export default async function Page({ params }: PageProps) {
  const { filename } = await params;
  const decoded = decodeURIComponent(filename);

  // Mirror what /api/applications/[num] does: resolve num from filename,
  // then findByNum (returns the full ApplicationDetail w/ embedded report).
  // useReport on the client derives the same num and queries the same
  // endpoint -- initialData seeds the cache so first render shows real
  // content instead of the renderer's loading skeleton.
  const num = numFromFilename(decoded);

  // A segment that can't resolve to an application num (`/report/abc`,
  // `/report/0`) can never load: useReport disables its query when the num
  // is null, so the client would sit on the loading skeleton forever.
  // 404 it server-side instead (app/not-found.tsx).
  if (num === null) notFound();

  let initialEntry: ApplicationEntry | null = null;
  try {
    // findByNum returns ApplicationDetail (zod-parsed); the client
    // ApplicationEntry interface is a structural subset. Cast through
    // unknown to bridge schema nullable() vs interface optional() the
    // same way /table and /pipeline pages do.
    const detail = findByNum(ROOT, num);
    initialEntry = (detail as unknown as ApplicationEntry) ?? null;
  } catch {
    // Missing or malformed applications.md — let the client query surface
    // the error path through TanStack Query.
  }

  return <ReportPage filename={decoded} initialEntry={initialEntry} />;
}
