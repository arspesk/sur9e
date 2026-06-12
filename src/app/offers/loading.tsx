'use client';

// Default route-level fallback for /offers. Reads the ?view=kanban
// searchParam at render time and dispatches to either the table or the
// kanban skeleton so the loading state matches the destination view.
// loading.tsx fires BEFORE page.tsx runs, so this is the only place
// we can pick the right skeleton without a flash of the wrong one.
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { BoardSkeleton } from '@/features/pipeline/board-skeleton';
import { TableLoading } from '@/features/table/table-loading';

function Inner() {
  const params = useSearchParams();
  const view = params?.get('view') === 'kanban' ? 'kanban' : 'table';
  const label = view === 'kanban' ? 'Loading pipeline board…' : 'Loading offers…';
  return (
    <div aria-busy="true" aria-label={label}>
      <div className="page-head">
        <div>
          <span
            className="sk"
            style={{ display: 'block', height: 40, width: 160, borderRadius: 6 }}
          />
          <span
            className="sk"
            style={{ display: 'block', height: 16, width: 320, borderRadius: 4, marginTop: 8 }}
          />
        </div>
      </div>

      <div
        className="filter-bar"
        style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <span className="sk" style={{ height: 36, width: 280, borderRadius: 4 }} />
        <span className="sk" style={{ height: 28, width: 84, borderRadius: 999 }} />
        <span className="sk" style={{ height: 28, width: 96, borderRadius: 999 }} />
        <span className="sk" style={{ height: 28, width: 72, borderRadius: 999 }} />
      </div>

      {view === 'kanban' ? <BoardSkeleton /> : <TableLoading />}
    </div>
  );
}

// Minimal pre-Suspense placeholder so the user never sees a blank frame
// between mount and useSearchParams resolution. Matches the page-head
// shape rendered by Inner so the layout doesn't jump.
function PreResolve() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading…">
      <div className="page-head">
        <div>
          <span
            className="sk"
            style={{ display: 'block', height: 40, width: 160, borderRadius: 6 }}
          />
          <span
            className="sk"
            style={{ display: 'block', height: 16, width: 320, borderRadius: 4, marginTop: 8 }}
          />
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  // useSearchParams requires a Suspense boundary somewhere above it.
  return (
    <Suspense fallback={<PreResolve />}>
      <Inner />
    </Suspense>
  );
}
