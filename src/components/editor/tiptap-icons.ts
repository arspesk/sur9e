// Inline-SVG icon factory used across the editor surface. Paths sourced from
// the lucide icon set (https://lucide.dev) so we match Novel's visual idiom.
// Built with createElementNS so we never touch innerHTML for icon SVG
// (security hooks block innerHTML even for static literals).

const SVG_NS = 'http://www.w3.org/2000/svg';

interface IconSpec {
  size: number;
  stroke: number;
  fill?: string;
  // Each entry is [tagName, attrs, textContent?] — the third slot lets a
  // <text> element carry its glyph (e.g. the callout's "T" character).
  paths: Array<[string, Record<string, string | number>, string?]>;
}

// All lucide icons render at viewBox 0 0 24 24, fill=none, stroke=currentColor,
// stroke-width 2, round caps/joins. `size` here is the pixel dimension we want
// in the editor chrome (lucide source uses 24×24 by default).
const ICONS: Record<string, IconSpec> = {
  bold: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M14 12a4 4 0 0 0 0-8H6v8' }],
      ['path', { d: 'M15 20a4 4 0 0 0 0-8H6v8Z' }],
    ],
  },
  italic: {
    size: 16,
    stroke: 2,
    paths: [
      ['line', { x1: 19, x2: 10, y1: 4, y2: 4 }],
      ['line', { x1: 14, x2: 5, y1: 20, y2: 20 }],
      ['line', { x1: 15, x2: 9, y1: 4, y2: 20 }],
    ],
  },
  underline: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M6 4v6a6 6 0 0 0 12 0V4' }],
      ['line', { x1: 4, x2: 20, y1: 20, y2: 20 }],
    ],
  },
  strike: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M16 4H9a3 3 0 0 0-2.83 4' }],
      ['path', { d: 'M14 12a4 4 0 0 1 0 8H6' }],
      ['line', { x1: 4, x2: 20, y1: 12, y2: 12 }],
    ],
  },
  highlight: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'm9 11-6 6v3h9l3-3' }],
      ['path', { d: 'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4' }],
    ],
  },
  code: {
    size: 16,
    stroke: 2,
    paths: [
      ['polyline', { points: '16 18 22 12 16 6' }],
      ['polyline', { points: '8 6 2 12 8 18' }],
    ],
  },
  h1: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M4 12h8' }],
      ['path', { d: 'M4 18V6' }],
      ['path', { d: 'M12 18V6' }],
      ['path', { d: 'm17 12 3-2v8' }],
    ],
  },
  h2: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M4 12h8' }],
      ['path', { d: 'M4 18V6' }],
      ['path', { d: 'M12 18V6' }],
      ['path', { d: 'M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1' }],
    ],
  },
  h3: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M4 12h8' }],
      ['path', { d: 'M4 18V6' }],
      ['path', { d: 'M12 18V6' }],
      ['path', { d: 'M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2' }],
      ['path', { d: 'M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2' }],
    ],
  },
  // Lucide `heading-4` — H crossbar + "4" numeral.
  h4: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M4 12h8' }],
      ['path', { d: 'M4 18V6' }],
      ['path', { d: 'M12 18V6' }],
      ['path', { d: 'M17 10v4h4' }],
      ['path', { d: 'M21 10v8' }],
    ],
  },
  link: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M9 17H7A5 5 0 0 1 7 7h2' }],
      ['path', { d: 'M15 7h2a5 5 0 1 1 0 10h-2' }],
      ['line', { x1: 8, x2: 16, y1: 12, y2: 12 }],
    ],
  },
  // lucide `list-collapse` — Notion-style toggle (chevrons + lines).
  toggle: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'm3 10 2.5-2.5L3 5' }],
      ['path', { d: 'm3 19 2.5-2.5L3 14' }],
      ['path', { d: 'M10 6h11' }],
      ['path', { d: 'M10 12h11' }],
      ['path', { d: 'M10 18h11' }],
    ],
  },
  // Toggle heading composites — a small filled chevron at x=1-5 plus the
  // standard lucide heading-N glyph shifted right (+3) so the two elements
  // don't overlap. Width is bumped to 20 so the composite reads larger than a
  // plain H{n}. These mirror the SVGs in slash-items-basic.ts so the slash menu
  // and the `::` Turn-into surface render the same family of icons.
  toggleH1: {
    size: 20,
    stroke: 2,
    paths: [
      [
        'polygon',
        { class: 'toggle-chev', points: '1,8 1,16 5,12', fill: 'currentColor', stroke: 'none' },
      ],
      ['path', { d: 'M7 12h7' }],
      ['path', { d: 'M7 18V6' }],
      ['path', { d: 'M14 18V6' }],
      ['path', { d: 'm19 12 3-2v8' }],
    ],
  },
  toggleH2: {
    size: 20,
    stroke: 2,
    paths: [
      [
        'polygon',
        { class: 'toggle-chev', points: '1,8 1,16 5,12', fill: 'currentColor', stroke: 'none' },
      ],
      ['path', { d: 'M7 12h7' }],
      ['path', { d: 'M7 18V6' }],
      ['path', { d: 'M14 18V6' }],
      ['path', { d: 'M22 18h-3.5c0-3 3.5-3 3.5-5.5 0-1.3-1.7-2.2-3.5-1' }],
    ],
  },
  toggleH3: {
    size: 20,
    stroke: 2,
    paths: [
      [
        'polygon',
        { class: 'toggle-chev', points: '1,8 1,16 5,12', fill: 'currentColor', stroke: 'none' },
      ],
      ['path', { d: 'M7 12h7' }],
      ['path', { d: 'M7 18V6' }],
      ['path', { d: 'M14 18V6' }],
      ['path', { d: 'M18.5 10.5c1.5-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2' }],
      ['path', { d: 'M18 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2' }],
    ],
  },
  // Toggle list — chevron + horizontal lines (bullet-list glyph). Same composite
  // layout as the toggle headings so the family reads as one.
  toggleList: {
    size: 20,
    stroke: 2,
    paths: [
      [
        'polygon',
        { class: 'toggle-chev', points: '1,8 1,16 5,12', fill: 'currentColor', stroke: 'none' },
      ],
      ['line', { x1: 9, x2: 21, y1: 7, y2: 7 }],
      ['line', { x1: 9, x2: 21, y1: 12, y2: 12 }],
      ['line', { x1: 9, x2: 21, y1: 17, y2: 17 }],
    ],
  },
  // lucide `external-link` — open the link in a new tab from the link popover.
  external: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M15 3h6v6' }],
      ['path', { d: 'M10 14 21 3' }],
      ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
    ],
  },
  plus: {
    size: 18,
    stroke: 2,
    paths: [
      ['path', { d: 'M5 12h14' }],
      ['path', { d: 'M12 5v14' }],
    ],
  },
  // Lucide `grip-vertical` — 6 dots in two columns, used as the drag handle.
  grip: {
    size: 16,
    stroke: 2,
    paths: [
      ['circle', { cx: 9, cy: 12, r: 1 }],
      ['circle', { cx: 9, cy: 5, r: 1 }],
      ['circle', { cx: 9, cy: 19, r: 1 }],
      ['circle', { cx: 15, cy: 12, r: 1 }],
      ['circle', { cx: 15, cy: 5, r: 1 }],
      ['circle', { cx: 15, cy: 19, r: 1 }],
    ],
  },
  // Lucide `grip-horizontal` — 6 dots in two horizontal rows. Used by the
  // column grip so it visually aligns with the column axis (vs. `grip`'s
  // vertical pair of columns, which fits the row grip).
  gripHorizontal: {
    size: 16,
    stroke: 2,
    paths: [
      ['circle', { cx: 12, cy: 9, r: 1 }],
      ['circle', { cx: 19, cy: 9, r: 1 }],
      ['circle', { cx: 5, cy: 9, r: 1 }],
      ['circle', { cx: 12, cy: 15, r: 1 }],
      ['circle', { cx: 19, cy: 15, r: 1 }],
      ['circle', { cx: 5, cy: 15, r: 1 }],
    ],
  },
  trash: {
    size: 14,
    stroke: 2,
    paths: [
      ['polyline', { points: '3 6 5 6 21 6' }],
      ['path', { d: 'M19 6l-2 14H7L5 6' }],
      ['path', { d: 'M10 11v6' }],
      ['path', { d: 'M14 11v6' }],
    ],
  },
  copy: {
    size: 14,
    stroke: 2,
    paths: [
      ['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }],
      ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
    ],
  },
  // Lucide `check` — the "copied" confirmation state on the code-block copy button.
  check: {
    size: 14,
    stroke: 2,
    paths: [['path', { d: 'M20 6 9 17l-5-5' }]],
  },
  arrowRight: {
    size: 14,
    stroke: 2,
    paths: [
      ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }],
      ['polyline', { points: '12 5 19 12 12 19' }],
    ],
  },
  // Lucide `chevron-right` — subtle submenu indicator (replaces the heavier
  // full arrow on the Turn into / Color rows; matches Notion's `›` affordance).
  chevronRight: {
    size: 14,
    stroke: 2,
    paths: [['path', { d: 'm9 18 6-6-6-6' }]],
  },
  // Lucide `replace` — two squares with swap arrows. Reads as "turn this
  // block into another type" far better than the old `code` glyph.
  turnInto: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M14 4a2 2 0 0 1 2-2' }],
      ['path', { d: 'M16 10a2 2 0 0 1-2-2' }],
      ['path', { d: 'M20 2a2 2 0 0 1 2 2' }],
      ['path', { d: 'M22 8a2 2 0 0 1-2 2' }],
      ['path', { d: 'm3 7 3 3 3-3' }],
      ['path', { d: 'M6 10V5a3 3 0 0 1 3-3' }],
      ['rect', { x: 2, y: 14, width: 8, height: 8, rx: 2 }],
    ],
  },
  // Lucide `remove-formatting` — "Tx" with a strike, the canonical
  // clear-formatting glyph. Replaces the wrong `plus` icon on Reset formatting.
  removeFormatting: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M4 7V4h16v3' }],
      ['path', { d: 'M5 20h6' }],
      ['path', { d: 'M13 4 8 20' }],
      ['path', { d: 'm15 15 5 5' }],
      ['path', { d: 'm20 15-5 5' }],
    ],
  },
  // Lucide `clipboard` — distinct from `copy` (used by Duplicate) so the two
  // rows no longer share an icon.
  clipboard: {
    size: 14,
    stroke: 2,
    paths: [
      ['rect', { width: 8, height: 4, x: 8, y: 2, rx: 1, ry: 1 }],
      ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }],
    ],
  },
  // Lucide `palette` — the Color submenu trigger. Dots carry the accent via
  // an explicit fill (the icon factory leaves svg-level fill at none).
  palette: {
    size: 16,
    stroke: 2,
    paths: [
      ['circle', { cx: 13.5, cy: 6.5, r: 0.5, fill: 'currentColor', stroke: 'none' }],
      ['circle', { cx: 17.5, cy: 10.5, r: 0.5, fill: 'currentColor', stroke: 'none' }],
      ['circle', { cx: 8.5, cy: 7.5, r: 0.5, fill: 'currentColor', stroke: 'none' }],
      ['circle', { cx: 6.5, cy: 12.5, r: 0.5, fill: 'currentColor', stroke: 'none' }],
      [
        'path',
        {
          d: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z',
        },
      ],
    ],
  },
  // Lucide `smile` — the callout "Edit icon" row + emoji affordance.
  smile: {
    size: 16,
    stroke: 2,
    paths: [
      ['circle', { cx: 12, cy: 12, r: 10 }],
      ['path', { d: 'M8 14s1.5 2 4 2 4-2 4-2' }],
      ['line', { x1: 9, x2: 9.01, y1: 9, y2: 9 }],
      ['line', { x1: 15, x2: 15.01, y1: 9, y2: 9 }],
    ],
  },
  arrowLeft: {
    size: 14,
    stroke: 2,
    paths: [
      ['line', { x1: 19, y1: 12, x2: 5, y2: 12 }],
      ['polyline', { points: '12 19 5 12 12 5' }],
    ],
  },
  arrowUp: {
    size: 14,
    stroke: 2,
    paths: [
      ['line', { x1: 12, y1: 19, x2: 12, y2: 5 }],
      ['polyline', { points: '5 12 12 5 19 12' }],
    ],
  },
  arrowDown: {
    size: 14,
    stroke: 2,
    paths: [
      ['line', { x1: 12, y1: 5, x2: 12, y2: 19 }],
      ['polyline', { points: '19 12 12 19 5 12' }],
    ],
  },
  // Lucide `pilcrow` — paragraph block marker.
  paragraph: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M13 4v16' }],
      ['path', { d: 'M17 4v16' }],
      ['path', { d: 'M19 4H9.5a4.5 4.5 0 0 0 0 9H13' }],
    ],
  },
  // Lucide `list` — bullet list.
  list: {
    size: 16,
    stroke: 2,
    paths: [
      ['line', { x1: 8, x2: 21, y1: 6, y2: 6 }],
      ['line', { x1: 8, x2: 21, y1: 12, y2: 12 }],
      ['line', { x1: 8, x2: 21, y1: 18, y2: 18 }],
      ['line', { x1: 3, x2: 3.01, y1: 6, y2: 6 }],
      ['line', { x1: 3, x2: 3.01, y1: 12, y2: 12 }],
      ['line', { x1: 3, x2: 3.01, y1: 18, y2: 18 }],
    ],
  },
  // Lucide `list-ordered` — numbered list.
  listOrdered: {
    size: 16,
    stroke: 2,
    paths: [
      ['line', { x1: 10, x2: 21, y1: 6, y2: 6 }],
      ['line', { x1: 10, x2: 21, y1: 12, y2: 12 }],
      ['line', { x1: 10, x2: 21, y1: 18, y2: 18 }],
      ['path', { d: 'M4 6h1v4' }],
      ['path', { d: 'M4 10h2' }],
      ['path', { d: 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1' }],
    ],
  },
  // Lucide `list-checks` — to-do list.
  listChecks: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'm3 17 2 2 4-4' }],
      ['path', { d: 'm3 7 2 2 4-4' }],
      ['path', { d: 'M13 6h8' }],
      ['path', { d: 'M13 12h8' }],
      ['path', { d: 'M13 18h8' }],
    ],
  },
  // Lucide `quote` — blockquote.
  quote: {
    size: 16,
    stroke: 2,
    paths: [
      [
        'path',
        {
          d: 'M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z',
        },
      ],
      [
        'path',
        {
          d: 'M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z',
        },
      ],
    ],
  },
  // Lucide `minus` — divider / horizontal rule.
  minus: {
    size: 16,
    stroke: 2,
    paths: [['path', { d: 'M5 12h14' }]],
  },
  // Lucide `square-code` — code block.
  squareCode: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M10 9.5 8 12l2 2.5' }],
      ['path', { d: 'm14 9.5 2 2.5-2 2.5' }],
      ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ],
  },
  // Lucide `table` — 3×3 grid.
  table: {
    size: 16,
    stroke: 2,
    paths: [
      ['path', { d: 'M12 3v18' }],
      ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
      ['path', { d: 'M3 9h18' }],
      ['path', { d: 'M3 15h18' }],
    ],
  },
  // Lucide `image` — picture frame with sun + mountain.
  image: {
    size: 16,
    stroke: 2,
    paths: [
      ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2, ry: 2 }],
      ['circle', { cx: 9, cy: 9, r: 2 }],
      ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
    ],
  },
  // Callout — Notion-style "T" inside a rounded square. Same glyph as
  // the slash-menu ICON.callout in slash-items-basic.ts so the two
  // surfaces render the same icon for the same item.
  callout: {
    size: 16,
    stroke: 2,
    paths: [
      ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }],
      [
        'text',
        {
          x: 12,
          y: 17,
          'text-anchor': 'middle',
          'font-size': 13,
          'font-weight': 700,
          'font-family': 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          fill: 'currentColor',
          stroke: 'none',
        },
        'T',
      ],
    ],
  },
};

export function makeIcon(name: string): SVGSVGElement {
  const spec = ICONS[name];
  if (!spec) throw new Error(`unknown icon: ${name}`);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(spec.size));
  svg.setAttribute('height', String(spec.size));
  svg.setAttribute('fill', spec.fill || 'none');
  if (spec.stroke > 0) {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(spec.stroke));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs, textContent] of spec.paths) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (textContent) el.textContent = textContent;
    svg.appendChild(el);
  }
  return svg;
}
