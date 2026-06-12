// Pipeline board skeleton — placeholder columns + cards rendered while the
// first /api/applications fetch is in flight (in-component) and as the
// route-level loading.tsx fallback (Suspense). Centralised here so the
// Suspense fallback and the client `query.isPending` branch in
// `pipeline-page.tsx` render the same DOM — no visual jump on hand-off.
//
// Per UX rules: each card mirrors the real .card-company (15.5px) +
// .card-role (13.5px) + .card-meta (12px) shape, varied widths for natural
// rhythm, text bars 4px radius (cards use the real .card class so they
// inherit border-radius: var(--radius) = 6px).

import { COLUMNS } from './board-types';

interface BoardSkeletonProps {
  // Optional status filter — when present, only those columns render. The
  // in-component caller passes the user's current filter so the skeleton
  // matches the post-load column set; the route-level loading.tsx omits it
  // and gets all 8 columns.
  statusFilter?: readonly string[];
}

// Width palette so consecutive cards don't look identical.
const COMPANY_WIDTHS = ['78%', '62%', '88%'];
const ROLE_WIDTHS = ['85%', '70%', '55%'];
const META_WIDTHS = [120, 96, 140];

export function BoardSkeleton({ statusFilter = [] }: BoardSkeletonProps) {
  const visible =
    statusFilter.length === 0 ? COLUMNS : COLUMNS.filter(c => statusFilter.includes(c.key));
  return (
    <div className="board-wrap" aria-busy="true" aria-label="Loading pipeline board…">
      <div className="board variant-dense">
        {visible.map(col => (
          <div key={col.key} className="column" data-status={col.key}>
            <div className="col-head">
              <div className="col-head-row">
                <div className="col-title-block">
                  <span className="col-dot" />
                  <span className="col-title">{col.label}</span>
                </div>
                {/* col-count mirror — small numeral pill */}
                <span
                  className="sk"
                  style={{ display: 'inline-block', height: 14, width: 28, borderRadius: 4 }}
                />
              </div>
            </div>
            <div className="col-body">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card board-skeleton-card">
                  {/* card-company — 15.5px display */}
                  <span
                    className="sk"
                    style={{
                      display: 'block',
                      height: 15,
                      width: COMPANY_WIDTHS[i % COMPANY_WIDTHS.length],
                      borderRadius: 4,
                    }}
                  />
                  {/* card-role — 13.5px body */}
                  <span
                    className="sk"
                    style={{
                      display: 'block',
                      height: 13,
                      width: ROLE_WIDTHS[i % ROLE_WIDTHS.length],
                      borderRadius: 4,
                    }}
                  />
                  {/* card-meta — 12px mono (status · comp · date) */}
                  <span
                    className="sk"
                    style={{
                      display: 'block',
                      height: 11,
                      width: META_WIDTHS[i % META_WIDTHS.length],
                      borderRadius: 4,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
