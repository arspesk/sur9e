'use client';

// features/analytics/stat-grid.tsx
//
// Four KPI tiles from analytics.html (lines 250-255 + inline-script lines
// 532-559): Screened / Applied / Month spend / All-time spend. Deltas
// compare the current range against either the previous range (Screened
// and Applied) or the previous calendar month (Month spend). All-time
// spend has no delta per spec.

import { Card } from '@/components/primitives';
import type { DeltaResult } from '@/lib/analytics/compute';

interface StatCardProps {
  label: string;
  value: string | number;
  delta?: DeltaResult;
}

function StatCard({ label, value, delta }: StatCardProps) {
  const deltaCls = delta?.kind ? `stat-delta ${delta.kind}` : 'stat-delta';
  return (
    <Card className="stat-card anim-enter">
      <div className="stat-label">{label}</div>
      <div className="stat-val">{value}</div>
      {delta !== undefined && (
        <div className={deltaCls} title="vs the previous period of the same length">
          {delta.text}
        </div>
      )}
    </Card>
  );
}

interface StatGridProps {
  screened: number;
  applied: number;
  monthSpend: string;
  allTimeSpend: string;
  screenedDelta: DeltaResult;
  appliedDelta: DeltaResult;
  monthSpendDelta: DeltaResult;
}

export function StatGrid(props: StatGridProps) {
  return (
    <div className="stat-grid">
      <StatCard label="Screened" value={props.screened} delta={props.screenedDelta} />
      <StatCard label="Applied" value={props.applied} delta={props.appliedDelta} />
      <StatCard label="Month spend" value={props.monthSpend} delta={props.monthSpendDelta} />
      <StatCard label="All-time spend" value={props.allTimeSpend} />
    </div>
  );
}
