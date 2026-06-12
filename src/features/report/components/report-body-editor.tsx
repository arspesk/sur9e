// src/features/report/components/report-body-editor.tsx
'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { preprocessRunningModeComments } from '@/components/editor/extensions/running-mode-node';
import { preprocessLegacyToggles } from '@/components/editor/legacy-toggle-shim';
import type { SlashContext } from '@/components/editor/slash-registry';
import { useSaveReportBody } from '@/hooks/use-save-report-body';
import { setReportHeadings } from '../toc-items';

const TipTapEditor = dynamic(
  () => import('@/components/editor/tiptap-editor').then(m => m.TipTapEditor),
  { ssr: false, loading: () => <div className="md-section-loading" aria-busy="true" /> },
);

interface ReportBodyEditorProps {
  filename: string;
  initialBody: string;
  num: number;
  status: string;
}

const DEBOUNCE_MS = 600;

// Strip inline markdown from a heading's raw text so TOC labels (and the
// slug fed to heading anchors) match ProseMirror's node.textContent —
// heading-id.ts's slugs MUST stay in sync with these (see its header).
export function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text (first)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

// Slug a heading title for both the TOC store and the DOM id attr.
// Module-level so it can be called from buildTocFromMarkdown without
// a hook closure.
function slugHeading(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Build the TOC: h1/h2/h3 walked from the markdown body.
// Exported for unit testing; the component wraps this in useCallback.
// heading-id.ts MUST produce identical slugs — both call stripInlineMarkdown
// before slugging, so they stay in sync.
export function buildTocFromMarkdown(md: string): { id: string; title: string; level: number }[] {
  const headings: { id: string; title: string; level: number }[] = [];
  // h1/h2/h3 included so users typing `# Foo` or activating /heading-1
  // see their entry in the rail too. Empty headings (e.g. just-inserted
  // `##` before any text) are skipped — they'd render as blank stripes
  // and confuse the user.
  //
  // De-dup slug ids: two headings with identical text produce the same
  // slug; append `-2`, `-3`, … to subsequent occurrences so React keys
  // stay unique (and applyHeadingIds doesn't fight itself for the same
  // DOM id either).
  const seen = new Map<string, number>();
  for (const m of md.matchAll(/^(#{1,3})\s+(.+)$/gm)) {
    const level = m[1].length;
    const title = stripInlineMarkdown(m[2]);
    if (!title) continue;
    const base = slugHeading(title);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    headings.push({ id, title, level });
  }
  return headings;
}

export function ReportBodyEditor({ filename, initialBody, num, status }: ReportBodyEditorProps) {
  const save = useSaveReportBody();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest markdown that has been typed but not yet sent (a debounce is in
  // flight), together with the report file it was typed into. Held so the
  // unmount cleanup can flush it; null whenever nothing is pending. The
  // filename is captured at edit time because the drawer reuses this
  // component instance across prev/next navigation (cached offers skip the
  // skeleton remount), so the `filename` prop — and any stale closure over
  // it — can point at a DIFFERENT report by the time the flush runs. See the
  // cleanup effect below.
  const pendingSaveRef = useRef<{ filename: string; body: string } | null>(null);
  const ctx: SlashContext = { num, status, filename };

  // The editor always renders/edits the whole body — the drawer and /report
  // share this component 1:1 (whole-body saves in both).
  const sourceBody = useMemo(() => initialBody ?? '', [initialBody]);

  // R2-6: tiptap-markdown does NOT reconstruct the runningMode node from its
  // on-disk HTML comment, so a freshly-reloaded body would lose any in-flight
  // "Running…" card. Rewrite each running-mode comment into its self-describing
  // <div data-running-mode …> form so parseHTML restores the node (and its
  // NodeView re-mounts + resumes polling) on load. Non-comment lines pass
  // through unchanged.
  const defaultValue = useMemo(
    () => preprocessLegacyToggles(preprocessRunningModeComments(sourceBody)),
    [sourceBody],
  );

  // Heading DOM ids (for TOC anchor scrolling) are applied by the HeadingId
  // ProseMirror extension via node decorations — NOT by mutating the DOM here.
  // Setting h.id directly fought ProseMirror's MutationObserver: it stripped
  // the foreign id on re-render, the next keystroke re-added it, and the cycle
  // re-rendered nodes (recreating <img> elements → refetch → page jump).

  // The TL;DR entry is no longer a synthetic pin — every frontmatter-format
  // body starts with `## TL;DR` (a markdown heading that backs the
  // SnapshotNode widget below it), so the regex picks it up naturally.
  const buildToc = useCallback(
    (md: string) => buildTocFromMarkdown(md),
    // buildTocFromMarkdown is module-stable; safe empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onChange = useCallback(
    (md: string) => {
      // setReportHeadings is shallow-equal-skip so it only triggers a
      // re-render when the heading set actually changes. (DOM ids are applied
      // by the HeadingId extension's decorations, not from here.)
      setReportHeadings(buildToc(md));

      pendingSaveRef.current = { filename, body: md };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pendingSaveRef.current = null;
        save.mutate({ filename, body: md });
      }, DEBOUNCE_MS);
    },
    [filename, save, buildToc],
  );

  // On unmount (navigating away from /report, or closing the drawer), flush a
  // still-pending debounced save instead of dropping it. Without this, typing
  // and leaving within DEBOUNCE_MS cancels the timer and the last edit is lost
  // — a real data loss, distinct from the stale-cache-on-return bug. The PATCH
  // started here completes in the background after the component is gone (its
  // error toast routes through a global store, so it still surfaces). The
  // flush reads the pending payload (body + the filename it was typed into)
  // from a ref, NOT from this closure's `filename` prop — the first-mount
  // closure goes stale when the drawer reuses the instance across prev/next
  // navigation, which used to flush one offer's edits into another offer's
  // report file. save.mutate is stable, so the empty-deps capture is
  // intentional.
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (pendingSaveRef.current != null) {
        save.mutate(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Seed the TOC store from the initialBody so the rail is populated before
  // the user types anything. Runs once per mount. (Heading DOM ids come from
  // the HeadingId extension's decorations.)
  useEffect(() => {
    setReportHeadings(buildToc(sourceBody));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <article className="report-body prose-novel">
      <TipTapEditor
        name={`report-${num}`}
        ariaLabel="Report body"
        placeholder={
          status === 'screened'
            ? "Type '/' to add a block — '/evaluate' to start the evaluation"
            : "Type '/' for commands or just start writing…"
        }
        defaultValue={defaultValue}
        onChange={onChange}
        slashContext={ctx}
      />
    </article>
  );
}
