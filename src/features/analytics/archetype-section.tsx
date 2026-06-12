'use client';

// Top-5 archetypes by count. Each row: name, proportional bar (fill =
// pct of max), count, share of the filtered period.

import { Card } from '@/components/primitives';
import type { ApplicationRow } from '@/features/table/table-types';
import { topArchetypes } from '@/lib/analytics/compute';

interface ArchetypeSectionProps {
  // Accept the full ApplicationRow shape (or any compatible record). The
  // reducer only reads `summary.archetype_short` / `summary.archetype`.
  entries: ApplicationRow[];
}

export function ArchetypeSection({ entries }: ArchetypeSectionProps) {
  const top5 = topArchetypes(entries, 5);
  const archetypeTotal = entries.length;

  return (
    <Card className="archetype-card anim-enter">
      <h2>Top archetypes</h2>
      <div className="archetype-rows" id="archetypeRows" role="list">
        {top5.length === 0 ? (
          <div className="archetype-empty">No archetype data in this period.</div>
        ) : (
          (() => {
            const max = top5[0]!.count;
            return top5.map(({ name, count }) => {
              const pct = archetypeTotal > 0 ? Math.round((count / archetypeTotal) * 1000) / 10 : 0;
              const fillPct = max > 0 ? (count / max) * 100 : 0;
              return (
                <div
                  className="archetype-row"
                  key={name}
                  role="listitem"
                  aria-label={`${name}: ${count} offers, ${pct}%`}
                >
                  <span className="archetype-name" title={name} aria-hidden="true">
                    {name}
                  </span>
                  <div className="archetype-bar">
                    <div
                      className="archetype-fill"
                      style={{ width: `${fillPct}%` }}
                      aria-hidden="true"
                    />
                  </div>
                  <span className="archetype-count" aria-hidden="true">
                    {count}
                  </span>
                  <span className="archetype-pct" aria-hidden="true">
                    {pct}%
                  </span>
                </div>
              );
            });
          })()
        )}
      </div>
    </Card>
  );
}
