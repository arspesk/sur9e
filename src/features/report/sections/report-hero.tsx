// The status pill keeps the `drawer-status-trigger` class + data-num
// attr so it shares CSS with the table row and drawer-header consumers
// — all three trigger surfaces drive the same StatusPopover store.

'use client';

import { Fragment } from 'react';
import { scoreLevel } from '@/components/domain';
import { CompanyAvatar } from '@/components/domain/company-avatar';
import { statusLabel } from '@/components/domain/status-pill';
import { EnumPill } from '@/components/enum-pill';
import type { FieldOption } from '@/components/field-popover';
import { InlineTextEdit } from '@/components/inline-text-edit';
import { useProfileQuery } from '@/hooks/use-profile';
import { legitTierBand, legitTierLabel } from '@/lib/scoring';
import {
  cityFromLocations,
  coerceWorkMode,
  VALID_SENIORITY,
  VALID_WORK_MODE,
} from '@/lib/server/report-schema';
import { useStatusPopoverStore } from '@/stores/status-popover-store';
import { CountUpScore } from '../components/count-up-score';
import { displayDate, fmtDate, type ReportR } from '../report-types';

interface ReportHeroProps {
  r: ReportR;
}

export function ReportHero({ r }: ReportHeroProps) {
  // Reactive aria-expanded for the status pill trigger (fix #18).
  const statusPopoverOpen = useStatusPopoverStore(s => s.open?.num === r.num && s.open !== null);
  const { data: profile } = useProfileQuery();

  const legit = r.legitimacy as { tier?: string } | string | undefined;
  const tier =
    (legit && typeof legit === 'object' && legit.tier) || (typeof legit === 'string' ? legit : '');
  const status = r.status || (r.state === 'evaluated' ? 'evaluated' : 'screened');
  const pillClass = `pill-${status}`;
  const pillLabel = statusLabel(status);
  // 'N/A' = screened-but-unscored (unreadable/prefiltered) — render the
  // sentinel literally instead of a fabricated 0.0 numeral.
  const scoreNum = typeof r.score === 'number' ? r.score : null;
  const level = scoreLevel(scoreNum ?? 0);
  const scoreClass = `score-${level}`;

  // Archetype options come from the user's profile target roles, plus a
  // permanent "Off-target" escape hatch. If the profile has no archetypes
  // the dropdown still renders with just Off-target.
  const archetypeOptions: FieldOption[] = [
    ...(profile?.target_roles?.archetypes ?? [])
      .map(a => a.name)
      .filter((n): n is string => Boolean(n))
      .map(n => ({ key: n, label: n })),
    { key: 'Off-target', label: 'Off-target' },
  ];
  const seniorityOptions: FieldOption[] = VALID_SENIORITY.map(s => ({ key: s, label: s }));
  const workModeOptions: FieldOption[] = VALID_WORK_MODE.map(s => ({ key: s, label: s }));
  // Resolve work mode the same way the table/kanban summary does
  // (canonical field, falling back to the legacy `remote` string) so every
  // surface shows the same value.
  const workModeValue = r.work_mode || coerceWorkMode(r.remote);

  const onStatusClick: React.MouseEventHandler<HTMLButtonElement> = e => {
    e.preventDefault();
    e.stopPropagation();
    useStatusPopoverStore.getState().show({
      anchor: e.currentTarget,
      num: r.num,
      currentStatus: r.status ?? '',
    });
  };

  const scoreBarCls = level === 'high' ? '' : level;
  const scoreFilled = scoreNum == null ? 0 : Math.round(scoreNum);

  // Factual meta items: location + comp are inline-editable; the date is
  // read-only. Source link removed from the header. Location + comp read the
  // canonical fields (city-resolved) so they match the table/kanban.
  // BOTH dates render inline (posted-date design, 2026-06-10): when a true
  // posting date is known, show "Posted {posted} · added {date}" so the
  // added/scan date is always visible — a native title tooltip was
  // unreliable and dead on touch. No posted → just "Added {date}". A
  // posting older than STALE_POSTED_DAYS tints the Posted part --st-warn.
  const dd = displayDate(r);
  const locValue = r.location || cityFromLocations(r.locations);
  const compValue = r.comp || '';
  const dateNode =
    dd.kind === 'posted' ? (
      <span key="date" className="hero-meta-strip__item">
        <span
          style={dd.stale ? { color: 'var(--st-warn)' } : undefined}
          title={dd.stale ? 'Listing has been up 30+ days' : undefined}
        >
          Posted {fmtDate(dd.value)}
        </span>
        <span style={{ color: 'var(--meta)' }}> · Added {fmtDate(r.date)}</span>
      </span>
    ) : (
      <span key="date" className="hero-meta-strip__item" style={{ color: 'var(--meta)' }}>
        Added {fmtDate(dd.value)}
      </span>
    );
  const metaItems: React.ReactNode[] = [
    <InlineTextEdit
      key="loc"
      num={r.num}
      field="location"
      value={locValue}
      ariaLabel="Edit location"
      placeholder="Add city"
    />,
    <InlineTextEdit
      key="comp"
      num={r.num}
      field="comp"
      value={compValue}
      ariaLabel="Edit comp"
      placeholder="Add comp"
    />,
    dateNode,
  ];

  return (
    <div className="hero">
      <div>
        <div className="hero-eyebrow">
          <button
            type="button"
            className={`pill ${pillClass} drawer-status-trigger`}
            data-num={r.num}
            aria-haspopup="menu"
            aria-expanded={statusPopoverOpen}
            onClick={onStatusClick}
          >
            <span className="dot" aria-hidden="true" />
            {pillLabel}
          </button>
          <EnumPill
            num={r.num}
            field="archetype"
            value={r.archetype || ''}
            options={archetypeOptions}
            placeholder="Set archetype"
          />
          <EnumPill
            num={r.num}
            field="seniority"
            value={r.seniority ?? ''}
            options={seniorityOptions}
            placeholder="Set seniority"
          />
          <EnumPill
            num={r.num}
            field="work_mode"
            value={workModeValue}
            options={workModeOptions}
            placeholder="Set work mode"
          />
        </div>
        <div className="hero-id-row">
          <CompanyAvatar company={r.company} logoUrl={r.company_logo} href={r.url} />
          <div>
            <h1>{r.company}</h1>
            <div className="hero-role">{r.role}</div>
          </div>
        </div>
        <div className="hero-meta-strip">
          {metaItems.map((node, idx) => (
            <Fragment key={idx}>
              {node}
              {idx < metaItems.length - 1 && (
                <span className="hero-meta-strip__sep" aria-hidden="true">
                  ·
                </span>
              )}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="hero-score">
        {scoreNum == null ? (
          <div className={`score-numeral ${scoreClass}`}>
            N/A<span className="denom">/5</span>
          </div>
        ) : (
          <CountUpScore target={scoreNum} className={`score-numeral ${scoreClass}`} />
        )}
        <div className={`score-bar ${scoreBarCls}`}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className={`seg ${i <= scoreFilled ? 'on' : ''}`} />
          ))}
        </div>
        <div className={`legit-pill ${legitTierBand(tier)}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
          </svg>
          {legitTierLabel(tier) || tier}
        </div>
      </div>
    </div>
  );
}
