import type { ChatMessage } from '@/lib/schemas/chat';

export type TranscriptUnit =
  | { kind: 'single'; message: ChatMessage }
  | { kind: 'versions'; group: string; versions: ChatMessage[] };

/** Fold consecutive assistant messages sharing a version_group into one unit
 * (versions in position order — regeneration appends, so DB order holds). */
export function groupTranscript(messages: ChatMessage[]): TranscriptUnit[] {
  const units: TranscriptUnit[] = [];
  for (const m of messages) {
    const g = m.role === 'assistant' ? m.versionGroup : null;
    const prev = units[units.length - 1];
    if (g && prev?.kind === 'versions' && prev.group === g) prev.versions.push(m);
    else if (g) units.push({ kind: 'versions', group: g, versions: [m] });
    else units.push({ kind: 'single', message: m });
  }
  return units;
}
