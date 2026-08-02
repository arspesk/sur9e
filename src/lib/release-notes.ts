export interface ReleaseNotesSummary {
  title: string;
  items: string[];
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/\s*\(\[[^\]]+\]\(https?:\/\/[^)]+\)\)\s*$/, '')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatReleaseDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function parseReleaseNotes(
  version: string,
  changelog: string,
  releaseDate?: string,
): ReleaseNotesSummary {
  const lines = changelog.split(/\r?\n/);
  const featuresHeading = lines.findIndex(line => /^###\s+features\s*$/i.test(line.trim()));
  const candidateLines = featuresHeading >= 0 ? lines.slice(featuresHeading + 1) : lines;
  const items: string[] = [];

  for (const rawLine of candidateLines) {
    const trimmed = rawLine.trim();
    if (featuresHeading >= 0 && /^#{1,3}\s+/.test(trimmed)) break;
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/)?.[1];
    if (!bullet) continue;
    const cleaned = cleanMarkdown(bullet);
    if (cleaned && !items.includes(cleaned)) items.push(cleaned);
    if (items.length === 4) break;
  }

  if (items.length === 0) {
    const fallback = cleanMarkdown(
      lines.find(line => line.trim() && !/^#{1,6}\s+/.test(line.trim())) ?? '',
    );
    if (fallback) items.push(fallback);
  }

  const date = formatReleaseDate(releaseDate);
  return {
    title: `v${version}${date ? ` · ${date}` : ''}`,
    items,
  };
}
