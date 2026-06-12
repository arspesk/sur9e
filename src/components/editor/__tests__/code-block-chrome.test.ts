import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import { describe, expect, it } from 'vitest';
import { CodeBlockWithChrome } from '../extensions/code-block-view';

const lowlight = createLowlight(common);

function makeEditor(content = '') {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockWithChrome.configure({ lowlight, HTMLAttributes: { class: 'be-codeblock' } }),
      Markdown.configure({ html: true, tightLists: true, breaks: false }),
    ],
    content,
  });
}

function getMd(e: Editor) {
  return (e.storage as { markdown?: { getMarkdown(): string } }).markdown?.getMarkdown() ?? '';
}

describe('code block with chrome', () => {
  it('round-trips a fenced code block with its language and content', () => {
    const md = '```python\nprint("hi")\n```';
    const editor = makeEditor(md);

    let lang: string | null = null;
    let text = '';
    editor.state.doc.descendants(node => {
      if (node.type.name === 'codeBlock') {
        lang = node.attrs.language as string | null;
        text = node.textContent;
      }
      return true;
    });
    expect(lang).toBe('python');
    expect(text).toBe('print("hi")');

    // Serialization stays fenced markdown (the NodeView must not leak HTML).
    const out = getMd(editor);
    expect(out).toContain('```python');
    expect(out).toContain('print("hi")');
    expect(out).not.toContain('be-codeblock-wrap');
    editor.destroy();
  });

  it('renders the chrome: a language trigger (showing the language) and a copy button', () => {
    const editor = makeEditor('```js\nconst a = 1;\n```');
    const dom = editor.view.dom as HTMLElement;
    const langBtn = dom.querySelector('button.be-codeblock-lang');
    const langLabel = dom.querySelector('.be-codeblock-lang__label');
    const copy = dom.querySelector('button.be-codeblock-copy');
    const code = dom.querySelector('pre.be-codeblock > code');

    expect(langBtn).not.toBeNull();
    expect(copy).not.toBeNull();
    // contentDOM is the <code> element, so the text lives there (highlighting works).
    expect(code?.textContent).toContain('const a = 1;');
    // The trigger label reflects the node language.
    expect(langLabel?.textContent).toBe('js');
    editor.destroy();
  });

  it('opens a branded language dropdown with a search field that filters', () => {
    const editor = makeEditor('```text\nhello\n```');
    const dom = editor.view.dom as HTMLElement;
    const langBtn = dom.querySelector('button.be-codeblock-lang') as HTMLButtonElement;

    // No menu until the trigger is clicked.
    expect(document.querySelector('.be-codeblock-langmenu')).toBeNull();
    langBtn.click();

    const menu = document.querySelector('.be-codeblock-langmenu');
    expect(menu).not.toBeNull();
    const search = menu?.querySelector(
      'input.be-codeblock-langmenu__search',
    ) as HTMLInputElement | null;
    expect(search).not.toBeNull();
    const allItems = menu?.querySelectorAll('.be-codeblock-langmenu__item').length ?? 0;
    expect(allItems).toBeGreaterThan(10);

    // Typing filters the list.
    search!.value = 'pyth';
    search!.dispatchEvent(new Event('input'));
    const filtered = [...(menu?.querySelectorAll('.be-codeblock-langmenu__item') ?? [])].map(
      el => el.textContent,
    );
    expect(filtered).toEqual(['python']);
    editor.destroy();
  });

  it('reopening the picker highlights the CURRENT language after a change (live node, not the creation-time closure)', () => {
    const editor = makeEditor('```text\nhello\n```');
    const dom = editor.view.dom as HTMLElement;
    const langBtn = dom.querySelector('button.be-codeblock-lang') as HTMLButtonElement;

    // Pick python from the menu.
    langBtn.click();
    let menu = document.querySelector('.be-codeblock-langmenu');
    const python = [...(menu?.querySelectorAll('.be-codeblock-langmenu__item') ?? [])].find(
      el => el.textContent === 'python',
    ) as HTMLElement;
    python.dispatchEvent(new MouseEvent('mousedown'));

    // The node attr and the trigger label both updated.
    let lang: string | null = null;
    editor.state.doc.descendants(node => {
      if (node.type.name === 'codeBlock') lang = node.attrs.language as string | null;
      return true;
    });
    expect(lang).toBe('python');
    expect(dom.querySelector('.be-codeblock-lang__label')?.textContent).toBe('python');

    // Reopen — the active highlight must mark python, not the stale 'text'.
    langBtn.click();
    menu = document.querySelector('.be-codeblock-langmenu');
    const active = [
      ...(menu?.querySelectorAll('.be-codeblock-langmenu__item.is-active') ?? []),
    ].map(el => el.textContent);
    expect(active).toEqual(['python']);
    editor.destroy();
  });
});
