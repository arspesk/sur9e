// Analytics route skeleton — matches the real layout (Pipeline/Spend zones):
// .page-head + .analytics-content:
//   zone-label (Pipeline) → stat-grid → funnel-card → archetype-card
//   zone-label (Spend) → spend-section-card
// Per UX rules we render only the dominant shapes: zone label + 4 stat tiles
// + 1 funnel card with 5 rows. Other cards sit below the fold for the brief
// skeleton flash.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading analytics…">
      <div className="page-head">
        <div>
          <span
            className="sk"
            style={{ display: 'block', height: 40, width: 200, borderRadius: 6 }}
          />
          <span
            className="sk"
            style={{ display: 'block', height: 16, width: 380, borderRadius: 4, marginTop: 8 }}
          />
        </div>
      </div>

      <div className="analytics-content">
        {/* Zone label stub — matches .analytics-zone-label (11px uppercase) */}
        <span className="sk" style={{ display: 'block', height: 11, width: 56, borderRadius: 4 }} />

        {/* KPI stat grid — 4 tiles, each .stat-card has label (12px) +
            value (40px display numeral) + delta (11px). */}
        <div className="stat-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="stat-card">
              <span
                className="sk"
                style={{ display: 'block', height: 12, width: 88, borderRadius: 4 }}
              />
              <span
                className="sk"
                style={{
                  display: 'block',
                  height: 40,
                  width: 120,
                  borderRadius: 6,
                  marginTop: 6,
                }}
              />
              <span
                className="sk"
                style={{
                  display: 'block',
                  height: 11,
                  width: 60,
                  borderRadius: 4,
                  marginTop: 6,
                }}
              />
            </div>
          ))}
        </div>

        {/* Funnel card — h2 18px + 5 rows (each row is grid: label / bar /
            count / pct). Real .funnel-row is 120px / 1fr / 60px / 60px. */}
        <div className="funnel-card">
          <span
            className="sk"
            style={{ display: 'block', height: 18, width: 120, borderRadius: 4 }}
          />
          <div style={{ marginTop: 20 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr 60px 60px',
                  gap: 14,
                  alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span
                  className="sk"
                  style={{ display: 'block', height: 15, borderRadius: 4, width: '85%' }}
                />
                <span className="sk" style={{ display: 'block', height: 10, borderRadius: 5 }} />
                <span
                  className="sk"
                  style={{ display: 'block', height: 14, borderRadius: 4, width: '70%' }}
                />
                <span
                  className="sk"
                  style={{ display: 'block', height: 11, borderRadius: 4, width: '55%' }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
