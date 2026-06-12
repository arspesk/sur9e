'use client';

import { cn } from '@/lib/cn';
import { scoreLevel } from '@/lib/scoring';

// Re-exported for existing call sites that import it from this module / barrel.
export { scoreLevel };

interface ScoreChipProps {
  score: string | number;
  className?: string;
}

export function ScoreChip({ score, className }: ScoreChipProps) {
  const numeric = typeof score === 'number' ? score : Number.parseFloat(String(score));
  const level = Number.isNaN(numeric) ? 'low' : scoreLevel(numeric);
  const display = Number.isNaN(numeric) ? String(score) : numeric.toFixed(1);

  return (
    <span className={cn('score-chip', level, className)} aria-label={`Score: ${display}`}>
      {display}
    </span>
  );
}
