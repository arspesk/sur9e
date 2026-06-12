// In-document Attachments section. Renders at the bottom of the report
// body (after the editor), but only when at least one downloadable
// artifact exists on disk for this offer. Replaces the now-removed
// "Documents" trigger in the topbar — same downloads, more discoverable
// because they sit inside the document the user is reading.
//
// Each tile is an anchor that streams the artifact through /api/output
// (artifacts/output/<filename> on disk → public bytes). Hidden entirely
// when no downloadables exist.

'use client';

import type { ReportR } from '../report-types';

interface AttachmentTile {
  label: string;
  href: string;
  filename: string;
}

function toHref(p: string): string {
  // Stored paths are filesystem-relative
  // (e.g. artifacts/output/cv-foo.pdf) and need to route through
  // /api/output/<filename> rather than the root URL.
  return p.startsWith('artifacts/output/')
    ? `/api/output/${p.slice('artifacts/output/'.length)}`
    : `/${p}`;
}

function tilesForReport(r: ReportR): AttachmentTile[] {
  const tiles: AttachmentTile[] = [];
  if (r.cv_pdf_path) {
    const p = r.cv_pdf_path;
    tiles.push({ label: 'Tailored CV', href: toHref(p), filename: p.split('/').pop() ?? 'cv.pdf' });
  }
  if (r.cover_letter_path) {
    const p = r.cover_letter_path;
    tiles.push({
      label: 'Cover letter',
      href: toHref(p),
      filename: p.split('/').pop() ?? 'cover-letter.pdf',
    });
  }
  // Outreach is NOT an attachment anymore — it's prose appended into the report
  // body as a `## Outreach` markdown section (see content/modes/reach-out.md),
  // like research / interview-prep. Attachments are downloadable PDFs only
  // (Tailored CV, Cover letter). The legacy `outreach_path` download tile was
  // a markdown file masquerading as a "pack" and is intentionally dropped.
  return tiles;
}

export function ReportAttachments({ r }: { r: ReportR }) {
  const tiles = tilesForReport(r);
  if (tiles.length === 0) return null;

  return (
    <section className="report-attachments" id="attachments" aria-labelledby="attachments-h">
      <h2 className="report-attachments__title" id="attachments-h">
        Attachments
      </h2>
      <div className="report-attachments__grid">
        {tiles.map(t => (
          <a
            key={t.href}
            className="report-attachments__tile"
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            download={t.filename}
          >
            <span className="report-attachments__icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="14" y2="17" />
              </svg>
            </span>
            <span className="report-attachments__body">
              <span className="report-attachments__label">{t.label}</span>
              <span className="report-attachments__meta">{t.filename}</span>
            </span>
            <span className="report-attachments__action" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
