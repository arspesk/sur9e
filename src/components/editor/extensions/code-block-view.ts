// Code block with floating chrome (language picker + copy), in the spirit of
// Novel's / TipTap's reference code-block NodeView. It extends CodeBlockLowlight
// so the lowlight syntax-highlight plugin keeps working — the contentDOM stays
// the <code> element, so decorations land exactly as before; we only add a
// non-editable, absolutely-positioned toolbar that floats over the top-right of
// the <pre> and reveals on hover (so it never pushes the code or collides with
// the editor placeholder, which the old full-width header bar did).
//
// NodeView DOM:
//   <div class="be-codeblock-wrap" data-language=…>
//     <div class="be-codeblock-tools" contenteditable="false">   ← floats top-right
//       <button class="be-codeblock-lang"><span class="be-codeblock-lang__label">…</span> ▾</button>
//       <button class="be-codeblock-copy" aria-label="Copy code">[copy icon]</button>
//     </div>
//     <pre class="be-codeblock"><code class="language-…">…</code></pre>  ← contentDOM = <code>
//   </div>
//
// The language picker is a branded dropdown (matching the slash/block menus)
// with a search field on top, not a native <select>.

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { makeIcon } from '../tiptap-icons';

// Languages offered in the picker. Any of these is a valid lowlight language id
// (the `common` set). `text` maps to no highlighting.
const LANGUAGES = [
  'text',
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'graphql',
  'html',
  'java',
  'javascript',
  'json',
  'kotlin',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'scss',
  'shell',
  'sql',
  'swift',
  'typescript',
  'yaml',
];

export const CodeBlockWithChrome = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      // Live node reference — the closure `node` is a creation-time snapshot
      // (see the copy handler note below); update() refreshes this so the
      // language picker's active highlight and setNodeMarkup's attr spread
      // read current attrs instead of the stale ones.
      let currentNode = node;
      const langOf = () => (currentNode.attrs.language as string | null) || 'text';

      const wrap = document.createElement('div');
      wrap.className = 'be-codeblock-wrap';
      wrap.dataset.language = langOf();

      // Floating toolbar — absolutely positioned, hover-revealed (see CSS).
      const tools = document.createElement('div');
      tools.className = 'be-codeblock-tools';
      tools.contentEditable = 'false';

      // ── Language trigger (opens the branded dropdown) ──
      const langBtn = document.createElement('button');
      langBtn.type = 'button';
      langBtn.className = 'be-codeblock-lang';
      langBtn.tabIndex = -1;
      const langLabel = document.createElement('span');
      langLabel.className = 'be-codeblock-lang__label';
      langLabel.textContent = langOf();
      const langCaret = document.createElement('span');
      langCaret.className = 'be-codeblock-lang__caret';
      langCaret.textContent = '▾';
      langBtn.append(langLabel, langCaret);
      langBtn.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
      });

      // ── Copy (icon-only; checkmark on success) ──
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'be-codeblock-copy';
      copy.tabIndex = -1;
      copy.setAttribute('aria-label', 'Copy code');
      copy.title = 'Copy';
      copy.appendChild(makeIcon('copy'));
      let copyResetTimer: number | undefined;
      copy.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
      });
      const showCopied = () => {
        copy.replaceChildren(makeIcon('check'));
        copy.classList.add('is-copied');
        copy.title = 'Copied';
        window.clearTimeout(copyResetTimer);
        copyResetTimer = window.setTimeout(() => {
          copy.replaceChildren(makeIcon('copy'));
          copy.classList.remove('is-copied');
          copy.title = 'Copy';
        }, 1500);
      };
      copy.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        // Read the live contentDOM, NOT the closure `node` — `node` is the
        // NodeView's creation-time snapshot, so it's empty for a freshly inserted
        // block and stale after edits. `code.textContent` is always current.
        const text = code.textContent ?? '';
        const fallbackCopy = () => {
          // Some contexts reject the async Clipboard API (no focus / older
          // engines). Fall back to a hidden-textarea + execCommand('copy').
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            if (ok) showCopied();
          } catch {
            /* clipboard unavailable — nothing more we can do */
          }
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(showCopied, fallbackCopy);
        } else {
          fallbackCopy();
        }
      });

      tools.append(langBtn, copy);
      wrap.appendChild(tools);

      const pre = document.createElement('pre');
      pre.className = 'be-codeblock';
      const code = document.createElement('code');
      const initial = langOf();
      if (initial && initial !== 'text') code.className = `language-${initial}`;
      pre.appendChild(code);
      wrap.appendChild(pre);

      // ── Branded dropdown (search + filtered list), appended to <body> ──
      let menu: HTMLDivElement | null = null;
      // Position the (position:fixed) menu just under the trigger, flipping up
      // or clamping left when it would overflow the viewport. Reused on scroll /
      // resize so the menu stays glued to the trigger instead of detaching when
      // the page scrolls (the menu lives on <body>, not next to the button).
      const positionMenu = () => {
        if (!menu) return;
        const r = langBtn.getBoundingClientRect();
        const mr = menu.getBoundingClientRect();
        let top = r.bottom + 4;
        if (top + mr.height > window.innerHeight - 8) top = r.top - mr.height - 4;
        let left = r.left;
        if (left + mr.width > window.innerWidth - 8) left = window.innerWidth - mr.width - 8;
        menu.style.top = `${Math.max(8, top)}px`;
        menu.style.left = `${Math.max(8, left)}px`;
      };
      const closeMenu = () => {
        if (!menu) return;
        menu.remove();
        menu = null;
        // Opening the menu moves focus to its search field (on <body>), so the
        // wrap loses :focus-within and the toolbar would fade out, leaving the
        // dropdown anchored to nothing. `.menu-open` keeps it visible; drop it
        // on close.
        wrap.classList.remove('menu-open');
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', positionMenu);
      };
      const onDocDown = (e: MouseEvent) => {
        if (menu && !menu.contains(e.target as Node) && e.target !== langBtn) closeMenu();
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMenu();
        }
      };
      // Close on a page/ancestor scroll (so the menu never detaches), but NOT
      // when the scroll happens INSIDE the menu's own overflowing list — the
      // capture-phase listener catches those too, which was slamming the
      // dropdown shut the moment the user tried to scroll through it.
      const onScroll = (e: Event) => {
        if (menu && e.target instanceof Node && menu.contains(e.target)) return;
        closeMenu();
      };
      const setLanguage = (lang: string) => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (typeof pos !== 'number') return;
        const next = lang === 'text' ? null : lang;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            language: next,
          }),
        );
        closeMenu();
        editor.view.focus();
      };
      const openMenu = () => {
        if (menu) {
          closeMenu();
          return;
        }
        const current = langOf();
        menu = document.createElement('div');
        menu.className = 'be-codeblock-langmenu';

        const search = document.createElement('input');
        search.type = 'text';
        // Reuse the app's standard input chrome (.form-input) so the search
        // field matches every other input in the app.
        search.className = 'be-codeblock-langmenu__search form-input';
        search.placeholder = 'Search language…';
        search.spellcheck = false;
        search.autocomplete = 'off';
        menu.appendChild(search);

        const list = document.createElement('div');
        list.className = 'be-codeblock-langmenu__list';
        menu.appendChild(list);

        const render = (filter: string) => {
          list.replaceChildren();
          const f = filter.trim().toLowerCase();
          const matches = LANGUAGES.filter(l => l.includes(f));
          if (matches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'be-codeblock-langmenu__empty';
            empty.textContent = 'No match';
            list.appendChild(empty);
            return;
          }
          for (const lang of matches) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `be-codeblock-langmenu__item${lang === current ? ' is-active' : ''}`;
            item.textContent = lang;
            item.addEventListener('mousedown', e => {
              e.preventDefault();
              setLanguage(lang);
            });
            list.appendChild(item);
          }
        };
        render('');

        search.addEventListener('input', () => render(search.value));
        search.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = list.querySelector('.be-codeblock-langmenu__item') as HTMLElement | null;
            if (first) first.dispatchEvent(new MouseEvent('mousedown'));
          }
        });

        wrap.classList.add('menu-open');
        document.body.appendChild(menu);
        positionMenu();

        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        // Close on scroll (capture phase, so a scroll on ANY ancestor container
        // counts) — matches the slash / block (::) menus (R2-8). Repositioning
        // instead let the menu clamp to the viewport top once the trigger
        // scrolled off, which read as the dropdown "detaching" from the block.
        // onScroll ignores scrolls inside the menu so its list stays scrollable.
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', positionMenu);
        setTimeout(() => search.focus(), 0);
      };
      langBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        openMenu();
      });

      return {
        dom: wrap,
        contentDOM: code,
        update(updated) {
          if (updated.type.name !== node.type.name) return false;
          currentNode = updated;
          const nextLang = (updated.attrs.language as string | null) || 'text';
          wrap.dataset.language = nextLang;
          langLabel.textContent = nextLang;
          code.className = nextLang && nextLang !== 'text' ? `language-${nextLang}` : '';
          return true;
        },
        // The toolbar and the `.menu-open` class / data-language we toggle on the
        // wrapper are editor chrome, not document content. Without this, those
        // DOM mutations trip ProseMirror's MutationObserver into re-rendering the
        // node — which destroys this NodeView and slams the just-opened language
        // menu shut a tick later (the open-then-close bug). Ignore chrome
        // mutations; let everything in the <code> contentDOM through so typing +
        // syntax highlighting keep working.
        ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
          if (mutation.type === 'selection') return false;
          return mutation.target === wrap || tools.contains(mutation.target as Node);
        },
        destroy() {
          window.clearTimeout(copyResetTimer);
          closeMenu();
        },
      };
    };
  },
});
