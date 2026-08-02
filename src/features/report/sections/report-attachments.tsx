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

import { Download, FileText } from 'lucide-react';
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
  // Outreach is NOT an attachment — it's prose appended into the report body as
  // a `## Outreach` markdown section (see content/modes/reach-out.md), like
  // research / interview-prep / negotiate. Attachments are downloadable PDFs
  // only (Tailored CV, Cover letter); there is no separate outreach file.
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
              <FileText />
            </span>
            <span className="report-attachments__body">
              <span className="report-attachments__label">{t.label}</span>
              <span className="report-attachments__meta">{t.filename}</span>
            </span>
            <span className="report-attachments__action" aria-hidden="true">
              <Download />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
