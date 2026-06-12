// features/report/report-skeleton.tsx — shared loading skeleton for /report.
//
// Mirrors the REAL report composition (hero + TL;DR snapshot + body prose)
// instead of generic text bars, so the loading state doesn't jump when the
// content arrives. Reuses the live layout classes (.hero, .hero-eyebrow,
// .hero-id-row, .hero-meta-strip, .hero-score) so grid/spacing/container
// queries match the rendered page 1:1 at every width.
//
// Used by BOTH the route-level Suspense fallback
// (src/app/report/[filename]/loading.tsx) and the client query.isPending
// branch in report-page.tsx — keep them on this single component so the
// two states can't drift apart again.
//
// No hooks — safe to render from a server component.

const bar = (
  height: number,
  width: number | string,
  extra?: React.CSSProperties,
): React.CSSProperties => ({
  display: 'block',
  height,
  width,
  borderRadius: 4,
  ...extra,
});

const pill = (width: number): React.CSSProperties => bar(24, width, { borderRadius: 999 });

export function ReportSkeleton() {
  return (
    <div
      data-testid="report-loading"
      className="report-skeleton-host"
      role="status"
      aria-busy="true"
      aria-label="Loading report…"
    >
      {/* ── Hero — eyebrow pills · avatar + company/role · meta strip │ score block ── */}
      <div className="hero" data-skeleton="1">
        <div>
          <div className="hero-eyebrow">
            <span className="sk" style={pill(88)} />
            <span className="sk" style={pill(120)} />
            <span className="sk" style={pill(72)} />
            <span className="sk" style={pill(80)} />
          </div>
          <div className="hero-id-row">
            {/* Company avatar — matches .company-mark 56×56 */}
            <span className="sk" style={bar(56, 56, { borderRadius: 12, flexShrink: 0 })} />
            <div style={{ minWidth: 0, flex: 1 }}>
              {/* Company h1 (44px line) + role (19px) */}
              <span className="sk" style={bar(38, 'min(280px, 70%)', { borderRadius: 8 })} />
              <span className="sk" style={bar(17, 'min(190px, 50%)', { marginTop: 9 })} />
            </div>
          </div>
          <div className="hero-meta-strip">
            <span className="sk" style={bar(15, 96)} />
            <span className="sk" style={bar(15, 120)} />
            <span className="sk" style={bar(15, 132)} />
          </div>
        </div>
        {/* Score block — numeral, 5-seg bar, legit pill */}
        <div className="hero-score">
          <span className="sk" style={bar(96, 120, { borderRadius: 12 })} />
          <span className="sk" style={bar(4, 200, { borderRadius: 2 })} />
          <span className="sk" style={pill(132)} />
        </div>
      </div>

      {/* ── TL;DR snapshot — lede · match/watch cards │ radar ── */}
      <div className="report-section" data-skeleton="1" style={{ marginTop: 8 }}>
        <span className="sk" style={bar(20, 110, { borderRadius: 5 })} />
        <span className="sk" style={bar(14, '94%', { marginTop: 18 })} />
        <span className="sk" style={bar(14, '78%', { marginTop: 10 })} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 200px',
            gap: 20,
            marginTop: 24,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <span className="sk" style={bar(56, '100%', { borderRadius: 8 })} />
            <span className="sk" style={bar(56, '100%', { borderRadius: 8 })} />
          </div>
          <span className="sk" style={bar(124, '100%', { borderRadius: 8 })} />
        </div>
      </div>

      {/* ── First body section — heading + paragraph, last line varies ── */}
      <div className="report-section" data-skeleton="1" style={{ marginTop: 40 }}>
        <span className="sk" style={bar(20, 160, { borderRadius: 5 })} />
        <span className="sk" style={bar(14, '92%', { marginTop: 18 })} />
        <span className="sk" style={bar(14, '88%', { marginTop: 10 })} />
        <span className="sk" style={bar(14, '64%', { marginTop: 10 })} />
      </div>
    </div>
  );
}
