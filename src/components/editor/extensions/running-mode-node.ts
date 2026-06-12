import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { RunningModeView } from '@/features/report/components/running-mode-view';
import { escapeHtml } from '@/lib/escape-html';

export interface RunningModeAttrs {
  mode: string;
  num: number;
  startedAt: string;
  label: string;
}

const STALE_MS = 30 * 60 * 1000;

export function serializeRunningModeToComment(a: RunningModeAttrs): string {
  return `<!-- sur9e:running mode="${a.mode}" num="${a.num}" started="${a.startedAt}" label="${a.label}" -->`;
}

const COMMENT_RE =
  /^<!--\s*sur9e:running\s+mode="([^"]+)"\s+num="(\d+)"\s+started="([^"]+)"\s+label="([^"]+)"\s*-->$/;

export function parseRunningModeComment(line: string): RunningModeAttrs | null {
  const m = line.trim().match(COMMENT_RE);
  if (!m) return null;
  return { mode: m[1], num: Number(m[2]), startedAt: m[3], label: m[4] };
}

export function isStaleRunningMode(startedAt: string): boolean {
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STALE_MS;
}

/**
 * Reconstruct a self-describing `<div data-running-mode …>` from a single
 * running-mode HTML comment line. tiptap-markdown does NOT rebuild custom
 * nodes from HTML comments on load, so on reload we rewrite the clean
 * on-disk comment form into a div that parseHTML's getAttrs can restore
 * the node from (which then re-mounts the NodeView and resumes polling).
 *
 * Operates line-by-line: a line that is a running-mode comment becomes the
 * div; any other line passes through verbatim.
 */

export function runningModeCommentToDiv(line: string): string {
  const attrs = parseRunningModeComment(line);
  if (!attrs) return line;
  return (
    `<div data-running-mode data-mode="${escapeHtml(attrs.mode)}"` +
    ` data-num="${attrs.num}" data-started="${escapeHtml(attrs.startedAt)}"` +
    ` data-label="${escapeHtml(attrs.label)}"></div>`
  );
}

/**
 * Preprocess a markdown body before it is handed to the editor: rewrite
 * every running-mode comment line into its self-describing div form so the
 * placeholder node is reconstructed on load.
 */
export function preprocessRunningModeComments(body: string): string {
  if (!body.includes('sur9e:running')) return body;
  return body.split('\n').map(runningModeCommentToDiv).join('\n');
}

/**
 * Block-level atom node. The visual NodeView (glowing card + Dismiss) is
 * wired up in tiptap-editor.tsx via NodeViewRenderer. This file owns the
 * schema + markdown serializer hook (serializes to one HTML comment so the
 * placeholder survives a reload).
 */
export const RunningMode = Node.create({
  name: 'runningMode',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      mode: { default: '' },
      num: { default: 0 },
      startedAt: { default: '' },
      label: { default: 'Running…' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-running-mode]',
        getAttrs: el => ({
          mode: (el as HTMLElement).getAttribute('data-mode') || '',
          num: Number((el as HTMLElement).getAttribute('data-num') || 0),
          startedAt: (el as HTMLElement).getAttribute('data-started') || '',
          label: (el as HTMLElement).getAttribute('data-label') || 'Running…',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-running-mode': '',
        'data-mode': node.attrs.mode,
        'data-num': String(node.attrs.num),
        'data-started': node.attrs.startedAt,
        'data-label': node.attrs.label,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RunningModeView);
  },

  addStorage() {
    return {
      markdown: {
        // tiptap-markdown serializer state types are not exported, hence unknown
        serialize(state: unknown, node: unknown) {
          const writer = state as { write: (s: string) => void; closeBlock: (n: unknown) => void };
          const n = node as { attrs: RunningModeAttrs };
          const attrs = n.attrs;
          writer.write(`${serializeRunningModeToComment(attrs)}\n`);
          writer.closeBlock(node);
        },
      },
    };
  },
});
