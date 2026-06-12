// Shared Notion-like color palette for the editor's block-options "Color"
// submenu (text color + background color). Extracted from the old bubble-menu
// color popover so the single source of truth lives in one place now that
// color editing moved into the `::` block menu (see tiptap-block-menu.ts).
//
// Markdown round-trip: text colors apply via <span style="color:…"> (TipTap
// Color/TextStyle marks) and background colors apply either as a callout
// background attr or a <mark style="background:…"> highlight — tiptap-markdown's
// `html: true` serializes both as raw HTML that round-trips on parse.

export interface ColorSwatch {
  name: string;
  /** Empty string = the "Default" entry (clears the color / highlight). */
  value: string;
}

export const TEXT_COLORS: ColorSwatch[] = [
  { name: 'Default', value: '' },
  { name: 'Gray', value: '#9b9a97' },
  { name: 'Brown', value: '#a07559' },
  { name: 'Orange', value: '#d9730d' },
  { name: 'Yellow', value: '#cb912f' },
  { name: 'Green', value: '#448361' },
  { name: 'Blue', value: '#337ea9' },
  { name: 'Purple', value: '#9065b0' },
  { name: 'Pink', value: '#c14c8a' },
  { name: 'Red', value: '#d44c47' },
];

export const BG_COLORS: ColorSwatch[] = [
  { name: 'Default', value: '' },
  { name: 'Gray', value: 'rgba(155,154,151,0.28)' },
  { name: 'Brown', value: 'rgba(160,117,89,0.28)' },
  { name: 'Orange', value: 'rgba(217,115,13,0.28)' },
  { name: 'Yellow', value: 'rgba(203,145,47,0.32)' },
  { name: 'Green', value: 'rgba(68,131,97,0.32)' },
  { name: 'Blue', value: 'rgba(51,126,169,0.32)' },
  { name: 'Purple', value: 'rgba(144,101,176,0.32)' },
  { name: 'Pink', value: 'rgba(193,76,138,0.28)' },
  { name: 'Red', value: 'rgba(212,76,71,0.28)' },
];
