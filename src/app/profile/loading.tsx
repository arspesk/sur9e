// Profile route skeleton — matches the real .profile-layout shape:
// .page-head + .profile-layout (grid: optional sidebar at ≥1025px, form on
// the right). Renders 2 .form-section stubs (the form has 8 total; the
// rest sit below the fold during a brief skeleton flash).
//
// Per UX rules: 3-5 dominant shapes per page, exact dimension mirroring
// (page-head h1 40px / sub 16px, form-section h2 18px, input 36px).
export default function Loading() {
  return (
    <div className="profile-content" aria-busy="true" aria-label="Loading profile…">
      <div className="page-head">
        <div>
          <span
            className="sk"
            style={{ display: 'block', height: 40, width: 160, borderRadius: 6 }}
          />
          <span
            className="sk"
            style={{ display: 'block', height: 16, width: 280, borderRadius: 4, marginTop: 8 }}
          />
        </div>
      </div>

      <div className="profile-layout">
        <div className="profile-form">
          {Array.from({ length: 2 }).map((_, sec) => (
            <section key={sec} className="form-section">
              <span
                className="sk"
                style={{ display: 'block', height: 18, width: 140, borderRadius: 4 }}
              />
              <span
                className="sk"
                style={{
                  display: 'block',
                  height: 14,
                  width: '68%',
                  borderRadius: 4,
                  marginTop: 8,
                }}
              />
              <div className="form-grid form-grid--cols-2" style={{ marginTop: 20 }}>
                {Array.from({ length: 4 }).map((_, f) => (
                  <div key={f}>
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
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
