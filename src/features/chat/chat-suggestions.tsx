'use client';

// Conversation-starter chips for the empty chat. Grounded in the user's real
// tracker (offer names, counts, statuses) via a curated template pool — no AI
// call, zero tokens, instant. A random three are shown each time the empty
// state mounts; clicking one sends it immediately.

import {
  ArrowLeftRight,
  Award,
  ChevronRight,
  Clock,
  Filter,
  ListChecks,
  type LucideIcon,
  Mic,
  Send,
  Sparkles,
  Target,
} from 'lucide-react';
import { useMemo } from 'react';
import { useApplications } from '@/hooks/use-applications';

export interface SuggestionOffer {
  company: string;
  status: string;
  /** Parsed numeric score, when the row has one. */
  score?: number;
}

/** Statuses that mean the ball is in the user's court (mirrors the table's
 * "waiting on you" count). */
const WAITING = new Set(['screened', 'responded']);

const GENERIC = [
  'What should I focus on this week?',
  'What am I missing in my job search?',
  "How's my search going?",
];

/** A contextual leading icon per suggestion, matched on the (self-authored)
 * template phrasing so the chip hints at what it does — compare, interview,
 * follow-up, etc. — instead of a uniform sparkle. */
export function iconFor(text: string): LucideIcon {
  const t = text.toLowerCase();
  if (t.startsWith('compare ')) return ArrowLeftRight;
  if (t.includes('interview')) return Mic;
  if (t.includes('follow up') || t.includes('waiting on me')) return Clock;
  if (t.includes('screened') || t.includes('rejection')) return Filter;
  if (t.includes('take the') && t.includes('offer')) return Award;
  if (t.includes('outreach')) return Send;
  if (t.includes('evaluated')) return ListChecks;
  if (t.includes('strongest fit') || t.includes('worth pursuing')) return Target;
  return Sparkles;
}

/** Candidate pool: data-grounded starters (each guarded by what the tracker
 * actually contains, naming real companies + counts) followed by the generic
 * fallbacks that always apply — so an empty tracker still gets three chips. */
export function buildSuggestionPool(offers: SuggestionOffer[]): string[] {
  const pool: string[] = [];
  const norm = (s: string) => (s || '').toLowerCase();
  const withStatus = (s: string) => offers.filter(o => norm(o.status) === s);
  const named = offers.filter(o => o.company);
  const companies = [...new Set(named.map(o => o.company))];
  const total = offers.length;
  const waiting = offers.filter(o => WAITING.has(norm(o.status))).length;
  const topByScore = [...named].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

  if (companies.length >= 2) pool.push(`Compare ${companies[0]} and ${companies[1]}`);
  if (total >= 2) pool.push(`Which of my ${total} offers is the strongest fit?`);
  if (waiting > 0) pool.push(`I have ${waiting} waiting on me — what should I do next?`);

  const interview = withStatus('interview')[0];
  if (interview) pool.push(`Prep me for the ${interview.company} interview`);

  const gotOffer = withStatus('offer')[0];
  if (gotOffer) pool.push(`Should I take the ${gotOffer.company} offer?`);

  if (withStatus('rejected').length >= 2) pool.push('What patterns show up in my rejections?');
  if (withStatus('screened').length > 0) pool.push('Why might I be getting screened out?');
  if (withStatus('evaluated').length > 0) pool.push('Which evaluated offers should I apply to?');

  if (topByScore) {
    pool.push(`Is ${topByScore.company} worth pursuing?`);
    pool.push(`Draft outreach for ${topByScore.company}`);
  }

  pool.push(...GENERIC);
  return pool;
}

/** Random, de-duplicated selection of up to n suggestions. The rng is
 * injectable so the shuffle is deterministic under test. */
export function pickSuggestions(pool: string[], n = 3, rng: () => number = Math.random): string[] {
  const unique = [...new Set(pool)];
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  return unique.slice(0, n);
}

/** The three chips shown under the empty-state copy. */
export function ChatSuggestions({ onPick }: { onPick: (text: string) => void }) {
  const { data } = useApplications();
  // A fresh random three per mount (i.e. per time the empty chat appears);
  // recomputed once the offer list loads so the chips can name real offers.
  const suggestions = useMemo(() => {
    const offers: SuggestionOffer[] = (data?.entries ?? []).map(e => ({
      company: e.company,
      status: e.status,
      score: Number.parseFloat(e.score) || undefined,
    }));
    return pickSuggestions(buildSuggestionPool(offers), 3);
  }, [data]);

  if (suggestions.length === 0) return null;
  return (
    <ul className="chat-suggestions" aria-label="Conversation starters">
      {suggestions.map(s => {
        const Icon = iconFor(s);
        return (
          <li key={s}>
            <button type="button" className="chat-suggestion-chip" onClick={() => onPick(s)}>
              <Icon className="chat-suggestion-chip__icon" size={15} strokeWidth={2} aria-hidden />
              <span className="chat-suggestion-chip__text">{s}</span>
              <ChevronRight
                className="chat-suggestion-chip__arrow"
                size={14}
                strokeWidth={2}
                aria-hidden
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
