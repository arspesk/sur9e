'use client';

import {
  ArrowRight,
  Check,
  Circle,
  Lightbulb,
  ListChevronsUpDown,
  LoaderCircle,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { renderChatMarkdown } from './chat-markdown';
import type { ActivityEntry, FoldedItem } from './fold-events';

type Activity = Extract<FoldedItem, { kind: 'activity' }>;

/** Humanized verbs for the known sur9e MCP tools; anything else falls back
 * to "Running <name>". Tool names arrive bare or as mcp__<server>__<tool>. */
const TOOL_VERBS: Record<string, string> = {
  get_tracker: 'Reading the tracker',
  get_report: 'Reading report',
  get_profile_summary: 'Reading profile',
  get_pipeline: 'Reading pipeline',
  set_status: 'Setting status',
  update_offer: 'Updating offer',
  create_offer_from_text: 'Creating offer',
  start_job: 'Starting job',
  cancel_job: 'Cancelling job',
  start_workflow: 'Starting workflow',
  cancel_workflow: 'Cancelling workflow',
  list_jobs: 'Checking jobs',
  list_workflows: 'Checking workflows',
  list_modes: 'Loading modes',
  get_mode_instructions: 'Loading mode instructions',
  navigate: 'Opening',
};

function bareName(name: string): string {
  return name.replace(/^mcp__.+?__/, '');
}

function findLastEntry(
  entries: ActivityEntry[],
  pred: (entry: ActivityEntry) => boolean,
): ActivityEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (pred(entries[i])) return entries[i];
  }
  return undefined;
}

/** The live line's label: the actual current step, not a canned word. */
function liveLabel(activity: Activity): string {
  const running = findLastEntry(
    activity.entries,
    en => en.type === 'tool' && en.status === 'running',
  );
  if (running?.type === 'tool') {
    const name = bareName(running.name);
    const verb = TOOL_VERBS[name] ?? `Running ${name}`;
    return running.detail ? `${verb} ${running.detail}` : verb;
  }
  const last = activity.entries[activity.entries.length - 1];
  if (last?.type === 'thinking') return 'Thinking';
  if (last?.type === 'stage') return last.label;
  return 'Working';
}

function formatSpan(ms: number): string | null {
  const s = Math.round(ms / 1000);
  if (s < 1) return null;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Render a detail string; a "from → to" transition composes the Lucide
 * ArrowRight instead of the text arrow. */
function DetailText({ detail }: { detail: string }) {
  const i = detail.indexOf(' → ');
  if (i === -1) return <span className="chat-activity__detail">{detail}</span>;
  return (
    <span className="chat-activity__detail">
      <span>{detail.slice(0, i)}</span>
      <ArrowRight className="chat-activity__arrow" aria-hidden="true" />
      <span>{detail.slice(i + 3)}</span>
    </span>
  );
}

function ThinkingRow({ entry, followTs }: { entry: ActivityEntry; followTs?: number }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (entry.type !== 'thinking') return null;
  const span = entry.ts != null && followTs != null ? formatSpan(followTs - entry.ts) : null;
  const hasText = entry.text.trim().length > 0;
  return (
    <>
      <span className="chat-activity__glyph" aria-hidden="true">
        <Lightbulb className="chat-activity__dot" />
      </span>
      {hasText ? (
        <button
          type="button"
          className="chat-activity__think-toggle"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen(o => !o)}
        >
          {span ? `Thought for ${span}` : 'Thought'}
        </button>
      ) : (
        <span className="chat-activity__think-toggle">
          {span ? `Thought for ${span}` : 'Thought'}
        </span>
      )}
      <span />
      {open && hasText && (
        <div className="chat-activity__think-body" id={bodyId}>
          {/* Same safety contract as ChatMarkdownView (message-view.tsx):
              renderChatMarkdown escapes raw HTML tokens. Rendered here
              directly (not via ChatMarkdownView) to avoid a module cycle
              with message-view and the code-copy delegation it carries. */}
          <div
            className="chat-md"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: renderer escapes raw HTML
            dangerouslySetInnerHTML={{ __html: renderChatMarkdown(entry.text) }}
          />
        </div>
      )}
    </>
  );
}

function EntryGlyph({ entry, streaming }: { entry: ActivityEntry; streaming: boolean }) {
  if (entry.type === 'tool' && entry.status === 'done')
    return (
      <span className="chat-activity__glyph chat-activity__glyph--ok" aria-hidden="true">
        <Check />
      </span>
    );
  if (entry.type === 'tool' && entry.status === 'error')
    return (
      <span className="chat-activity__glyph chat-activity__glyph--err" aria-hidden="true">
        <X />
      </span>
    );
  // Still running: a spinner while live, a neutral dot on a historical
  // (interrupted) burst — a frozen spinner in history reads as broken.
  return (
    <span className="chat-activity__glyph" aria-hidden="true">
      {entry.type === 'tool' && streaming ? (
        <LoaderCircle className="chat-activity__spin" />
      ) : (
        <Circle className="chat-activity__dot" />
      )}
    </span>
  );
}

function Timeline({ entries, streaming }: { entries: ActivityEntry[]; streaming: boolean }) {
  return (
    <div className="chat-activity__timeline">
      {entries.map((entry, i) => {
        // Fold order is stable within a turn — index keys are safe.
        const key = `${entry.type}${i}`;
        if (entry.type === 'thinking') {
          const followTs = entries
            .slice(i + 1)
            .map(en => en.ts)
            .find(t => t != null);
          return <ThinkingRow key={key} entry={entry} followTs={followTs} />;
        }
        if (entry.type === 'stage') {
          return (
            <span key={key} className="chat-activity__stage" style={{ gridColumn: '2 / 4' }}>
              {entry.label}
            </span>
          );
        }
        return (
          <span key={key} style={{ display: 'contents' }}>
            <EntryGlyph entry={entry} streaming={streaming} />
            <span className="chat-activity__name">{bareName(entry.name)}</span>
            {entry.detail ? <DetailText detail={entry.detail} /> : <span />}
          </span>
        );
      })}
    </div>
  );
}

/** The unified activity stream (issue #103 rework). Live: one shimmering
 * line naming the actual current step, with elapsed time. Settled: one quiet
 * summary line — "Worked · 41s · 9 steps [· N failed]" — that morphs in
 * place (no layout shift). Both expand to the full step timeline via the
 * ListChevronsUpDown affordance (never rotated — open state is tonal, same
 * rule as the old thinking caret). */
export function ActivityStream({
  activity,
  streaming,
}: {
  activity: Activity;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const timelineId = useId();
  const live = streaming && activity.status === 'running';

  // Elapsed while live: prefer the server's first event stamp; fall back to
  // mount time (same approximation the old ThinkingBlock made).
  const mountRef = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  // Providers sometimes emit a thinking event with no body; a settled burst
  // with no steps and no thinking text has nothing to show or expand.
  const hasThinkingText = activity.entries.some(en => en.type === 'thinking' && en.text.trim());
  if (!live && activity.steps === 0 && !hasThinkingText) return null;

  const toggle = (
    <ListChevronsUpDown
      className="chat-activity__caret"
      aria-hidden="true"
      data-open={open || undefined}
    />
  );

  let line: React.ReactNode;
  if (live) {
    const elapsed = formatSpan(now - (activity.startTs ?? mountRef.current));
    line = (
      <>
        <span className="chat-activity__label chat-activity__label--shimmer">
          {liveLabel(activity)}…
        </span>
        {elapsed && <span className="chat-activity__sec">· {elapsed}</span>}
        {toggle}
      </>
    );
  } else {
    const span =
      activity.startTs != null && activity.endTs != null
        ? formatSpan(activity.endTs - activity.startTs)
        : null;
    const parts = [
      'Worked',
      ...(span ? [span] : []),
      `${activity.steps} step${activity.steps === 1 ? '' : 's'}`,
      ...(activity.failed > 0 ? [`${activity.failed} failed`] : []),
    ];
    line = (
      <>
        <span
          className={`chat-activity__glyph ${
            activity.failed > 0 ? 'chat-activity__glyph--err' : 'chat-activity__glyph--ok'
          }`}
          aria-hidden="true"
        >
          {activity.failed > 0 ? <X /> : <Check />}
        </span>
        <span className="chat-activity__label">{parts.join(' · ')}</span>
        {toggle}
      </>
    );
  }

  return (
    <div className="chat-activity">
      <button
        type="button"
        className="chat-activity__line"
        aria-expanded={open}
        aria-controls={open ? timelineId : undefined}
        onClick={() => setOpen(o => !o)}
      >
        {line}
      </button>
      {open && (
        <div id={timelineId}>
          <Timeline entries={activity.entries} streaming={streaming} />
        </div>
      )}
    </div>
  );
}
