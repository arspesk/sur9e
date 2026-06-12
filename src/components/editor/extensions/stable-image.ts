// Image extension with a persistent NodeView.
//
// The stock @tiptap/extension-image renders via renderHTML, so when ProseMirror
// re-renders the surrounding inline content (which it does on essentially every
// keystroke) it can recreate the <img> element. A recreated <img> re-fires its
// network request; for an image that 404s (e.g. Notion icons pasted into a
// report whose URLs don't resolve here) the box collapses to 0 during each
// reload and everything below it reflows — the page "jumps" on every keystroke.
//
// This NodeView keeps ONE <img> element for the life of the node and only
// touches `src` when it actually changes, so the image is requested once and
// never flickers. `update` returns true for the same node type so ProseMirror
// reuses the element instead of tearing it down.

import Image from '@tiptap/extension-image';

export const StableImage = Image.extend({
  addNodeView() {
    const configuredAttrs = this.options.HTMLAttributes ?? {};
    return ({ node, HTMLAttributes }) => {
      const img = document.createElement('img');
      // Static attributes from configure() (e.g. class: 'be-image') merged with
      // the per-node rendered attributes.
      for (const [key, value] of Object.entries({ ...configuredAttrs, ...HTMLAttributes })) {
        if (value != null) img.setAttribute(key, String(value));
      }
      // Guarantee the base styling class regardless of how attrs merged.
      img.classList.add('be-image');
      const applyNodeAttrs = (n: typeof node) => {
        const src = (n.attrs.src as string | null) ?? '';
        // Only reassign src when it truly changed — reassigning the same value
        // re-triggers the network request and the collapse/reflow flicker.
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        const alt = (n.attrs.alt as string | null) ?? '';
        if (img.getAttribute('alt') !== alt) img.setAttribute('alt', alt);
        const title = n.attrs.title as string | null;
        if (title) {
          if (img.getAttribute('title') !== title) img.setAttribute('title', title);
        } else {
          img.removeAttribute('title');
        }
      };
      applyNodeAttrs(node);
      return {
        dom: img,
        update: updated => {
          if (updated.type.name !== node.type.name) return false;
          applyNodeAttrs(updated);
          return true;
        },
        // The <img> has no editable children; never let its own mutations
        // (e.g. the broken-image class we toggle) bubble back into ProseMirror.
        ignoreMutation: () => true,
      };
    };
  },
});
