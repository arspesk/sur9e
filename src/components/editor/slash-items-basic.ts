// Standard Notion-style block menu items, registered with the slash
// registry. registerBasicSlashItems is idempotent — safe under StrictMode
// and HMR.
import type { Editor } from '@tiptap/core';
// Side-effect import: registers setImage on the chain command surface.
import '@tiptap/extension-image';
import { applyToggle } from './extensions/details-block';
import { uploadAndInsertImages } from './image-upload';
import { registerSlashItem } from './slash-registry';

function setHeading(level: 1 | 2 | 3 | 4) {
  return (editor: Editor) => editor.chain().focus().clearNodes().setHeading({ level }).run();
}

// Lucide icon markup — viewBox 24×24, stroke=currentColor, no fill. Renders
// through cmdk-slash-menu's raw-HTML escape hatch for the icon column.
const SVG_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"';

function svg(inner: string): string {
  return `<svg ${SVG_ATTRS}>${inner}</svg>`;
}

const ICON = {
  h1: svg('<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/>'),
  h2: svg(
    '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>',
  ),
  h3: svg(
    '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/>',
  ),
  h4: svg(
    '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 10v4h4"/><path d="M21 10v8"/>',
  ),
  pilcrow: svg(
    '<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
  ),
  list: svg(
    '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  ),
  listOrdered: svg(
    '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  ),
  listChecks: svg(
    '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  ),
  quote: svg(
    '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>',
  ),
  minus: svg('<path d="M5 12h14"/>'),
  squareCode: svg(
    '<path d="M10 9.5 8 12l2 2.5"/><path d="m14 9.5 2 2.5-2 2.5"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
  ),
  table: svg(
    '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  ),
  image: svg(
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  ),
  // Callout — Notion-style "T" inside a rounded square.
  callout:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" stroke="none" fill="currentColor">T</text></svg>',
  // Toggle / collapsible — lucide `list-collapse` (chevrons + lines).
  toggle: svg(
    '<path d="m3 10 2.5-2.5L3 5"/><path d="m3 19 2.5-2.5L3 14"/><path d="M10 6h11"/><path d="M10 12h11"/><path d="M10 18h11"/>',
  ),
  // Toggle headings — a small filled chevron at x=1-5 plus the lucide heading-N
  // glyph shifted right (+3) so they don't overlap. Width bumped to 20 so the
  // composite reads larger than the plain H{n} entries.
  toggleH1:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="16" aria-hidden="true"><polygon class="toggle-chev" points="1,8 1,16 5,12" fill="currentColor" stroke="none"/><path d="M7 12h7"/><path d="M7 18V6"/><path d="M14 18V6"/><path d="m19 12 3-2v8"/></svg>',
  toggleH2:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="16" aria-hidden="true"><polygon class="toggle-chev" points="1,8 1,16 5,12" fill="currentColor" stroke="none"/><path d="M7 12h7"/><path d="M7 18V6"/><path d="M14 18V6"/><path d="M22 18h-3.5c0-3 3.5-3 3.5-5.5 0-1.3-1.7-2.2-3.5-1"/></svg>',
  toggleH3:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="16" aria-hidden="true"><polygon class="toggle-chev" points="1,8 1,16 5,12" fill="currentColor" stroke="none"/><path d="M7 12h7"/><path d="M7 18V6"/><path d="M14 18V6"/><path d="M18.5 10.5c1.5-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M18 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>',
  // Toggle list — chevron + horizontal lines (bullet-list glyph).
  toggleList:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="16" aria-hidden="true"><polygon class="toggle-chev" points="1,8 1,16 5,12" fill="currentColor" stroke="none"/><line x1="9" x2="21" y1="7" y2="7"/><line x1="9" x2="21" y1="12" y2="12"/><line x1="9" x2="21" y1="17" y2="17"/></svg>',
} as const;

const BASIC: Array<Parameters<typeof registerSlashItem>[0]> = [
  {
    id: 'basic-h1',
    group: 'Basic blocks',
    label: 'Heading 1',
    keywords: ['h1', 'heading', 'header', 'title', 'big'],
    icon: ICON.h1,
    command: setHeading(1),
  },
  {
    id: 'basic-h2',
    group: 'Basic blocks',
    label: 'Heading 2',
    keywords: ['h2', 'heading', 'header', 'title', 'subtitle', 'subheading'],
    icon: ICON.h2,
    command: setHeading(2),
  },
  {
    id: 'basic-h3',
    group: 'Basic blocks',
    label: 'Heading 3',
    keywords: ['h3', 'heading', 'header', 'title', 'subheading'],
    icon: ICON.h3,
    command: setHeading(3),
  },
  {
    id: 'basic-h4',
    group: 'Basic blocks',
    label: 'Heading 4',
    keywords: ['h4', 'heading', 'header', 'subheading', '#### '],
    icon: ICON.h4,
    command: setHeading(4),
  },
  {
    id: 'basic-p',
    group: 'Basic blocks',
    label: 'Paragraph',
    keywords: ['text', 'body', 'plain', 'paragraph', 'normal'],
    icon: ICON.pilcrow,
    command: e => e.chain().focus().clearNodes().setParagraph().run(),
  },
  {
    id: 'basic-ul',
    group: 'Basic blocks',
    label: 'Bullet list',
    keywords: ['bullet', 'list', 'unordered', 'ul', 'bullets', 'point'],
    icon: ICON.list,
    command: e => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'basic-ol',
    group: 'Basic blocks',
    label: 'Numbered list',
    keywords: ['numbered', 'ordered', 'ol', 'number', 'list', 'steps'],
    icon: ICON.listOrdered,
    command: e => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'basic-todo',
    group: 'Basic blocks',
    label: 'To-do list',
    keywords: ['task', 'checkbox', 'todo', 'to-do', 'check', 'checklist'],
    icon: ICON.listChecks,
    command: e => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'basic-quote',
    group: 'Basic blocks',
    label: 'Quote',
    keywords: ['blockquote', 'quote', 'citation', 'cite'],
    icon: ICON.quote,
    command: e => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'basic-callout',
    group: 'Basic blocks',
    label: 'Callout',
    keywords: ['note', 'info', 'tip', 'warning', 'aside', 'callout', 'box'],
    icon: ICON.callout,
    command: e =>
      e
        .chain()
        .focus()
        .insertContent({
          type: 'callout',
          attrs: { variant: 'info', emoji: '💡' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  ...([1, 2, 3] as const).map(level => ({
    id: `basic-toggle-h${level}`,
    group: 'Basic blocks',
    label: `Toggle heading ${level}`,
    keywords: ['collapsible', 'collapse', 'fold', 'toggle', `h${level}`],
    icon: ICON[`toggleH${level}` as 'toggleH1' | 'toggleH2' | 'toggleH3'],
    command: (e: Editor) => {
      applyToggle(e, 'heading', level);
    },
  })),
  {
    id: 'basic-toggle-list',
    group: 'Basic blocks',
    label: 'Toggle list',
    keywords: ['collapsible', 'collapse', 'fold', 'toggle', 'list'],
    icon: ICON.toggleList,
    command: (e: Editor) => {
      applyToggle(e, 'list');
    },
  },
  {
    id: 'basic-divider',
    group: 'Basic blocks',
    label: 'Divider',
    keywords: ['hr', 'horizontal rule', 'separator', 'line', 'rule', 'break'],
    icon: ICON.minus,
    command: e => e.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'basic-codeblock',
    group: 'Basic blocks',
    label: 'Code block',
    keywords: ['code', 'pre', 'snippet', 'codeblock', 'fence'],
    icon: ICON.squareCode,
    command: e => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'basic-table',
    group: 'Basic blocks',
    label: 'Table',
    keywords: ['grid', 'table', 'rows', 'columns', 'spreadsheet'],
    icon: ICON.table,
    command: e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'basic-image',
    group: 'Basic blocks',
    label: 'Image',
    keywords: ['picture', 'img', 'image', 'photo', 'upload'],
    icon: ICON.image,
    command: e => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = () => {
        const files = Array.from(input.files ?? []);
        if (files.length === 0) return;
        void uploadAndInsertImages(e, files, e.state.selection.from);
      };
      input.click();
    },
  },
];

let _registered = false;
export function registerBasicSlashItems(): void {
  if (_registered) return;
  _registered = true;
  for (const item of BASIC) {
    try {
      registerSlashItem(item);
    } catch {
      /* tolerate HMR re-imports */
    }
  }
}
