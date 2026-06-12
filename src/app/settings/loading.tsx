// Settings route skeleton — matches the real .settings-content shape:
// .page-head + .settings-nav (horizontal scroll of section anchors) + 2
// .form-section stubs. Last text line varies in width per UX rules.
//
// Per UX rules: 3-5 dominant shapes per page, exact dimension mirroring
// (page-head h1 40px / sub 16px, form-section h2 18px, input 36px).
export default function Loading() {
  return (
    <div className="settings-content" aria-busy="true" aria-label="Loading settings…">
      <div className="page-head">
        <div>
          <span
            className="sk"
            style={{ display: 'block', height: 40, width: 180, borderRadius: 6 }}
          />
          <span
            className="sk"
            style={{ display: 'block', height: 16, width: 320, borderRadius: 4, marginTop: 8 }}
          />
        </div>
      </div>

      <nav
        className="settings-nav"
        aria-label="Settings sections"
        style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}
      >
        {/* Real settings-nav is a horizontal scroller of section anchors;
            each item is ~28px tall with the text-3 link styling. Mirror 6
            items with varied widths instead of identical bars. */}
        {[64, 80, 60, 88, 72, 56].map((w, i) => (
          <span
            key={i}
            className="sk"
            style={{ display: 'inline-block', height: 14, width: w, borderRadius: 4 }}
          />
        ))}
      </nav>

      {Array.from({ length: 2 }).map((_, sec) => (
        <section key={sec} className="form-section">
          <span
            className="sk"
            style={{ display: 'block', height: 18, width: 120, borderRadius: 4 }}
          />
          <span
            className="sk"
            style={{
              display: 'block',
              height: 14,
              width: '62%',
              borderRadius: 4,
              marginTop: 8,
            }}
          />
          <div style={{ marginTop: 20 }}>
            <span
              className="sk"
              style={{ display: 'block', height: 11, width: 80, borderRadius: 4 }}
            />
            <span
              className="sk"
              style={{
                display: 'block',
                height: 36,
                width: '100%',
                borderRadius: 4,
                marginTop: 6,
              }}
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <span
              className="sk"
              style={{ display: 'block', height: 11, width: 64, borderRadius: 4 }}
            />
            <span
              className="sk"
              style={{
                display: 'block',
                height: 36,
                width: '70%',
                borderRadius: 4,
                marginTop: 6,
              }}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
