/* features/report/mode-slash-items.ts
 *
 * Register the 7 generator modes (evaluate, tailor-cv, cover-letter,
 * research, reach-out, interview-prep, negotiate) as slash-menu items.
 *
 * Registered once at /report mount via registerModeSlashItems(). When the
 * user picks `/evaluate` (or any other generator):
 *   1. A <runningMode> placeholder node is inserted inline at the caret.
 *   2. The corresponding modal opens via useModalStore.open(modalKey, ...).
 *   3. When the modal resolves (`onDone({ markdown })`), the placeholder
 *      is swapped out for the generated markdown — the modal side wires the
 *      completion contract. For now `onDone` runs even though existing
 *      modals don't pass `markdown`, so the placeholder is replaced with an
 *      empty string until that contract lands.
 *
 * Interactive modes (`apply`, `follow-up`) live in the report kebab via
 * STATUS_KEBAB_ACTIONS; `documents` lives in the topbar Documents button.
 * Neither belongs here.
 */

import type { Editor } from '@tiptap/core';
import { registerSlashItem, type SlashContext } from '@/components/editor/slash-registry';
import { useModalStore } from '@/stores/modal-store';
import {
  GENERATOR_MODES,
  type GeneratorMode,
  MODE_MODAL_KEY,
  MODE_REGISTRY,
} from './report-toolbar-config';

function runGeneratorMode(editor: Editor, mode: GeneratorMode, ctx: SlashContext) {
  if (ctx.num == null) return;
  const meta = MODE_REGISTRY[mode];
  // Insert the placeholder ONLY when the user confirms (Generate), not on
  // slash-pick. Cancel / backdrop / Escape must never create an orphan
  // "Running…" card. The modal calls this closure on confirm.
  const insertPlaceholder = () => {
    if (editor.isDestroyed) return;
    // Read the live caret at confirm time and clamp it to the current doc.
    // A position captured at slash-pick goes stale once the modal opens (the
    // `/mode` trigger text is deleted, the user may edit), and a stale/out-of-
    // range position makes insertContentAt throw "Position N out of range".
    const pos = Math.min(editor.state.selection.from, editor.state.doc.content.size);
    editor
      .chain()
      .focus()
      .insertContentAt(pos, {
        type: 'runningMode',
        attrs: {
          mode,
          num: ctx.num,
          startedAt: new Date().toISOString(),
          label: `Running ${meta?.label ?? mode}…`,
        },
      })
      .run();
  };
  useModalStore.getState().open(MODE_MODAL_KEY[mode], {
    num: ctx.num,
    onConfirm: insertPlaceholder,
    onDone: (result?: { markdown?: string }) => {
      const md = result?.markdown ?? '';
      // Empty markdown means the modal was dismissed without producing
      // result content (cover-letter / tailor-cv generate PDFs, not
      // markdown — completion is observed by the NodeView's job poll,
      // not by this callback). Leave the runningMode placeholder in
      // place so the user can watch the orange card and dismiss it
      // themselves when the job lands.
      if (!md) return;
      const doc = editor.state.doc;
      doc.descendants((node, p) => {
        if (
          node.type.name === 'runningMode' &&
          node.attrs.mode === mode &&
          node.attrs.num === ctx.num
        ) {
          editor.chain().focus().setNodeSelection(p).deleteSelection().insertContent(md).run();
          return false;
        }
        return true;
      });
    },
  });
}

let _registered = false;
export function registerModeSlashItems(): void {
  if (_registered) return;
  _registered = true;
  for (const mode of GENERATOR_MODES) {
    const meta = MODE_REGISTRY[mode];
    if (!meta) continue;
    registerSlashItem({
      id: `mode-${mode}`,
      group: 'AI generation',
      icon: meta.icon,
      label: meta.label,
      keywords: [meta.label, mode, meta.cliMode ?? ''].filter(Boolean),
      command: (editor, ctx) => runGeneratorMode(editor, mode, ctx),
      // Generator modes write to a specific report's runningMode placeholder
      // and call modals that need `num`. The profile / settings markdown
      // editors mount with an empty SlashContext — hide AI generation there.
      shouldShow: ctx => ctx.num != null,
    });
  }
}
