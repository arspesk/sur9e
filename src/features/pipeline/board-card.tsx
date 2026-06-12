'use client';

// Single offer card on the kanban board.
//
// K-B redesign: avatar left, company/role right, score numeral (replaces chip),
// pills row (archetype, seniority, work_mode), meta = Location · Comp · date.
// Ported from legacy pipeline.html renderCard(); drag + click handlers unchanged.

import { useRef } from 'react';
import { CompanyAvatar } from '@/components/domain/company-avatar';
import { scoreLevel } from '@/components/domain/score-chip';
import { EnumPill } from '@/components/enum-pill';
import { InlineTextEdit } from '@/components/inline-text-edit';
import { IconButton } from '@/components/primitives';
import { fmtDate } from '@/features/report/report-types';
import type { ApplicationRow } from '@/features/table/table-types';
import { useProfileQuery } from '@/hooks/use-profile';
import { VALID_SENIORITY, VALID_WORK_MODE } from '@/lib/server/report-schema';
import { useStatusPopoverStore } from '@/stores/status-popover-store';

interface BoardCardProps {
  row: ApplicationRow;
  isSelected: boolean;
  onClick: (num: number) => void;
  onDoubleClick: (num: number) => void;
  onActionsClick: (e: React.MouseEvent<HTMLButtonElement>, num: number) => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, num: number) => void;
  onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
}

export function BoardCard({
  row,
  isSelected,
  onClick,
  onDoubleClick,
  onActionsClick,
  onDragStart,
  onDragEnd,
}: BoardCardProps) {
  // Single click → drawer (220ms timer so dblclick → /report wins).
  // Drags suppress click via the data-dragging dataset flag.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);

  const score = Number.parseFloat(row.score) || 0;

  // Reactive aria-expanded for the status pill trigger (fix #18).
  const statusPopoverOpen = useStatusPopoverStore(s => s.open?.num === row.num && s.open !== null);

  const { data: profile } = useProfileQuery();

  // Archetype options: profile target-role archetype names + 'Off-target'
  // escape hatch (mirrors the table and report hero).
  const archetypeOptions = [
    ...(profile?.target_roles?.archetypes ?? [])
      .map((a: { name?: string }) => a.name)
      .filter((n): n is string => Boolean(n))
      .map((n: string) => ({ key: n, label: n })),
    { key: 'Off-target', label: 'Off-target' },
  ];

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.detail > 1 && e.button === 0) e.preventDefault();
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (draggingRef.current) return;
    const tgt = e.target as HTMLElement;
    if (tgt.closest('.board-card-kebab, .pill, button, .status-popover')) return;
    if (clickTimer.current) return;
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      onClick(row.num);
    }, 220);
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const tgt = e.target as HTMLElement;
    if (tgt.closest('.board-card-kebab, .pill, button, .status-popover')) return;
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    onDoubleClick(row.num);
  }

  return (
    <div
      className="card"
      role="article"
      tabIndex={0}
      aria-label={`${row.company} — ${row.role}`}
      aria-description="Press Enter to open the report"
      draggable
      data-id={row.num}
      data-num={row.num}
      data-selected={isSelected ? 'true' : 'false'}
      onDragStart={e => {
        draggingRef.current = true;
        onDragStart(e, row.num);
      }}
      onDragEnd={e => {
        // Clear the "dragging" flag a tick after dragend so the click
        // handler suppresses the just-dropped card's synthesized click.
        setTimeout(() => {
          draggingRef.current = false;
        }, 50);
        onDragEnd(e);
      }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(row.num);
        }
      }}
    >
      {/* Option C: identity-led — avatar + (company / role) with the score
          aligned to the company line; editable enum pills in a tight row
          below; meta line last. */}
      <div className="card-top">
        <CompanyAvatar company={row.company} logoUrl={row.company_logo} className="cmk" />
        <div className="card-id">
          <div className="card-id-line">
            <span className="card-company">{row.company}</span>
            <span className={`score-num ${scoreLevel(score)}`}>{score.toFixed(1)}</span>
          </div>
          <div className="card-role">{row.role}</div>
        </div>
        <IconButton
          className="board-card-kebab"
          label="Card actions"
          title="Card actions"
          aria-haspopup="menu"
          aria-expanded={statusPopoverOpen}
          data-num={row.num}
          onClick={e => onActionsClick(e, row.num)}
          icon={
            <span aria-hidden="true" className="icon-ellipsis">
              ⋯
            </span>
          }
        />
      </div>
      <div className="card-chips">
        <EnumPill
          num={row.num}
          field="archetype"
          value={row.archetype ?? ''}
          options={archetypeOptions}
          placeholder="—"
        />
        <EnumPill
          num={row.num}
          field="seniority"
          value={row.seniority ?? ''}
          options={VALID_SENIORITY.map(s => ({ key: s, label: s }))}
          placeholder="—"
        />
        <EnumPill
          num={row.num}
          field="work_mode"
          value={row.work_mode ?? ''}
          options={VALID_WORK_MODE.map(s => ({ key: s, label: s }))}
          placeholder="—"
        />
      </div>
      {/* Location + comp are inline-editable (same as the table). */}
      <div className="card-meta">
        <InlineTextEdit
          num={row.num}
          field="location"
          value={row.loc ?? ''}
          ariaLabel="Edit location"
          placeholder="—"
        />
        <span className="dot-sep">·</span>
        <InlineTextEdit
          num={row.num}
          field="comp"
          value={row.comp ?? ''}
          ariaLabel="Edit comp"
          placeholder="—"
        />
        <span className="dot-sep">·</span>
        {/* Both dates inline (posted-date design, 2026-06-10): 'Posted'
            primary when known; the 'Added' (scan) date is ALWAYS muted —
            secondary info whether or not a posting date exists. Unified
            fmtDate; no hover tooltip (unreliable + dead on touch). */}
        {row.posted ? (
          <span>
            Posted {fmtDate(row.posted)}
            <span className="card-meta__added"> · Added {fmtDate(row.date)}</span>
          </span>
        ) : (
          <span className="card-meta__added">Added {fmtDate(row.date)}</span>
        )}
      </div>
    </div>
  );
}
