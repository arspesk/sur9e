// markedInline / radarSVG return HTML strings; they mount via the React
// raw-HTML escape hatch on their target span/div.

import { useMemo } from 'react';
import { markedInline, type RadarAxis, type ReportR, radarSVG, sevWeight } from '../report-types';

interface ReportSnapshotProps {
  r: ReportR;
  /**
   * When true (used by SnapshotNodeView), drops the outer `<section
   * id="tldr">` wrapper and the block-head h2. The markdown body's
   * `## TL;DR` heading provides the title + the `id="tldr"` anchor
   * in that case. Legacy-format reports keep the wrapper.
   */
  inline?: boolean;
}

const clamp5 = (v: unknown) => Math.max(0, Math.min(5, Number(v) || 0));

export function ReportSnapshot({ r, inline = false }: ReportSnapshotProps) {
  const sb = r.score_breakdown || {
    cv_match: 0,
    seniority: 0,
    compensation: 0,
    domain: 0,
    geo: 0,
    legitimacy: 0,
  };

  // Derivations recompute only when their source slice of `r` changes
  // (status pill updates re-render the whole report tree; without memo
  // we'd re-sort gaps + rebuild the radar SVG on every drawer click).
  // Frontmatter format pre-selects the strongest match + watch-out via
  // r.snapshot.{match,watch}. Legacy format derives them from r.cv_match
  // and r.gaps arrays. Prefer the curated picks when present.
  const snap = r.snapshot;
  const matchPick = useMemo(() => {
    if (snap?.match?.cv || snap?.match?.jd) return snap.match;
    const directs = (r.cv_match || []).filter(m => m.strength === 'direct');
    return directs[0] || (r.cv_match || [])[0] || null;
  }, [snap?.match, r.cv_match]);

  const gapPick = useMemo(() => {
    if (snap?.watch?.title || snap?.watch?.mitigation) return snap.watch;
    const sorted = (r.gaps || [])
      .slice()
      .sort((a, b) => sevWeight(b.severity || '') - sevWeight(a.severity || ''));
    return sorted[0] || null;
  }, [snap?.watch, r.gaps]);

  const radarAxes: RadarAxis[] = useMemo(
    () => [
      { k: 'CV match', v: clamp5(sb.cv_match) },
      { k: 'Seniority', v: clamp5(sb.seniority) },
      { k: 'Comp', v: clamp5(sb.compensation) },
      { k: 'Domain', v: clamp5(sb.domain) },
      { k: 'Geo / mode', v: clamp5(sb.geo) },
      { k: 'Legitimacy', v: clamp5(sb.legitimacy) },
    ],
    [sb.cv_match, sb.seniority, sb.compensation, sb.domain, sb.geo, sb.legitimacy],
  );
  const radarMarkup = useMemo(() => radarSVG(radarAxes), [radarAxes]);

  const body = (
    <div className="block-body">
      <p className="lede" dangerouslySetInnerHTML={{ __html: markedInline(r.tldr || '') }} />

      <div className="snapshot-merged">
        <div className="matrix-label">Score breakdown</div>
        <div className="verdict-stack cd-anim-item">
          {matchPick && (
            <div className="gap-card match">
              <div className="gap-sev-bar" />
              <div>
                <div className="gap-title">Strongest match</div>
                <div className="gap-mit">
                  <span dangerouslySetInnerHTML={{ __html: markedInline(matchPick.cv || '') }} />{' '}
                  <em className="report-mute-em">— {matchPick.jd || ''}</em>
                </div>
              </div>
              <span className="sev low">match</span>
            </div>
          )}
          {gapPick && (
            <div className="gap-card high">
              <div className="gap-sev-bar" />
              <div>
                <div className="gap-title">Watch-out</div>
                <div className="gap-mit">
                  <strong>{gapPick.title || ''}</strong>{' '}
                  <span
                    dangerouslySetInnerHTML={{
                      __html: '— ' + markedInline(gapPick.mitigation || ''),
                    }}
                  />
                </div>
              </div>
              <span className="sev high">watch</span>
            </div>
          )}
        </div>
        <div className="matrix-pane cd-anim-item">
          <div className="cd-radar">
            <svg
              viewBox="0 0 180 160"
              role="img"
              aria-label="Match-axis radar — see scores in the adjacent list"
              dangerouslySetInnerHTML={{ __html: radarMarkup }}
            />
          </div>
          <div className="cd-radar-list">
            {radarAxes.map(a => (
              <div key={a.k} className="row">
                <span className="k">{a.k}</span>
                <span className="v">{a.v.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (inline) return body;

  return (
    <section id="tldr" className="block slim">
      <div className="block-head">
        <h2 className="block-title">TL;DR</h2>
      </div>
      {body}
    </section>
  );
}
