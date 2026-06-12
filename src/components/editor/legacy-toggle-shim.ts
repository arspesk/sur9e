// Convert legacy bespoke collapsible markup into plain markdown headings so old
// reports render under the new heading-fold system. Runs at load (client-side
// preprocess), never rewrites stored files. The body inside data-toggle-body is
// already markdown; we just unwrap it under a level-N heading from the summary.
const DETAILS_RE = /<details\b[^>]*\bdata-toggle-heading\b[^>]*>([\s\S]*?)<\/details>/gi;
const LEVEL_RE = /data-level=["']?(\d+)["']?/i;
const SUMMARY_RE = /<div\b[^>]*\bdata-toggle-summary\b[^>]*>([\s\S]*?)<\/div>/i;
const BODY_RE = /<div\b[^>]*\bdata-toggle-body\b[^>]*>([\s\S]*?)<\/div>/i;

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

export function preprocessLegacyToggles(md: string): string {
  if (!md.includes('data-toggle-heading')) return md;
  return md.replace(DETAILS_RE, (full: string, inner: string) => {
    const levelMatch = full.match(LEVEL_RE);
    // Clamp to 1–4: StarterKit heading only supports levels [1,2,3,4].
    const level = levelMatch ? Math.min(4, Math.max(1, Number(levelMatch[1]))) : 2;
    const summaryMatch = inner.match(SUMMARY_RE);
    const summary = summaryMatch ? stripTags(summaryMatch[1]) : '';
    let body = inner;
    if (summaryMatch) body = body.replace(summaryMatch[0], '');
    const bodyMatch = body.match(BODY_RE);
    const bodyMd = bodyMatch ? bodyMatch[1].trim() : '';
    return `\n${'#'.repeat(level)} ${summary}\n\n${bodyMd}\n`;
  });
}
