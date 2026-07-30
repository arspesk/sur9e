import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer } from '@/features/chat/chat-composer';
import { filterSlashItems, SLASH_ITEMS } from '@/features/chat/slash-popover';
import { CHAT_DISCOVERABLE_MODES } from '@/lib/modes/catalog';
import { DRAFT_OVERRIDE_KEY, useChatStore } from '@/stores/chat-store';

// The composer mounts useApplications (a TanStack Query hook) for the
// @-mention popover — mock it so no QueryClientProvider or fetch is needed.
// ModelChip mounts in the composer tools row now — mock its data hooks so
// no QueryClientProvider/fetch is needed; it renders its fallback pair.
vi.mock('@/hooks/use-provider-info', () => ({ useProviderInfo: () => ({ data: undefined }) }));
vi.mock('@/hooks/use-settings', () => ({ useSettingsQuery: () => ({ data: undefined }) }));

vi.mock('@/hooks/use-applications', () => ({
  useApplications: () => ({
    data: {
      entries: [
        { num: 48, company: 'Linear', role: 'Frontend', status: 'applied' },
        { num: 3, company: 'Attio', role: 'Staff Engineer', status: 'applied' },
      ],
      count: 2,
    },
  }),
}));

// Role-agnostic lookup: while the slash popover is open the textarea's role
// flips from the implicit "textbox" to "combobox" (WAI-ARIA combobox
// pattern), so a role-based query would miss it in that state.
function textarea() {
  return screen.getByLabelText('Message') as HTMLTextAreaElement;
}

describe('ChatComposer', () => {
  beforeEach(() => {
    useChatStore.setState({
      queuedMessages: {},
      queuedAttachments: {},
      activeConversationId: null,
    });
  });

  it('restores a HELD queued message into the input when not streaming', () => {
    useChatStore.setState({
      activeConversationId: 'c1',
      queuedMessages: { c1: 'held follow-up' },
    });
    render(
      <ChatComposer
        streaming={false}
        files={[]}
        onFilesChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    // Adopted into the input; the queue slot is cleared (no auto-send).
    expect(textarea().value).toBe('held follow-up');
    expect(useChatStore.getState().queuedMessages).toEqual({});
  });

  it('leaves the queued message in its slot WHILE streaming (real queue)', () => {
    useChatStore.setState({
      activeConversationId: 'c1',
      queuedMessages: { c1: 'follow-up' },
    });
    render(
      <ChatComposer
        streaming={true}
        files={[]}
        onFilesChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    expect(textarea().value).toBe('');
    expect(useChatStore.getState().queuedMessages).toEqual({ c1: 'follow-up' });
  });

  it('Enter sends the trimmed text and clears the input', () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        streaming={false}
        files={[]}
        onFilesChange={() => {}}
        onSend={onSend}
        onStop={() => {}}
      />,
    );
    fireEvent.change(textarea(), { target: { value: '  hello there  ' } });
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('hello there', []);
    expect(textarea().value).toBe('');
  });

  it('keeps the draft editable but blocks Enter and Send while the target thread loads', () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        streaming={false}
        sendDisabled
        files={[]}
        onFilesChange={() => {}}
        onSend={onSend}
        onStop={() => {}}
      />,
    );

    fireEvent.change(textarea(), { target: { value: 'keep this draft' } });
    fireEvent.keyDown(textarea(), { key: 'Enter' });

    expect(textarea().value).toBe('keep this draft');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('Shift+Enter does not send', () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        streaming={false}
        files={[]}
        onFilesChange={() => {}}
        onSend={onSend}
        onStop={() => {}}
      />,
    );
    fireEvent.change(textarea(), { target: { value: 'line one' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('while streaming, Enter queues instead of sending and shows the queued hint', () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        streaming={true}
        files={[]}
        onFilesChange={() => {}}
        onSend={onSend}
        onStop={() => {}}
      />,
    );
    fireEvent.change(textarea(), { target: { value: 'and then?' } });
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect(useChatStore.getState().queuedMessages[DRAFT_OVERRIDE_KEY]).toBe('and then?');
    expect(screen.getByText('Queued — sends when the reply finishes')).toBeTruthy();
  });

  it('shows Stop while streaming and Send otherwise', () => {
    const onStop = vi.fn();
    const { rerender } = render(
      <ChatComposer
        streaming={true}
        files={[]}
        onFilesChange={() => {}}
        onSend={() => {}}
        onStop={onStop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop reply' }));
    expect(onStop).toHaveBeenCalled();
    rerender(
      <ChatComposer
        streaming={false}
        files={[]}
        onFilesChange={() => {}}
        onSend={() => {}}
        onStop={onStop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy();
  });

  it('"/" at position 0 opens the slash listbox with all modes', () => {
    render(
      <ChatComposer
        streaming={false}
        files={[]}
        onFilesChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    fireEvent.change(textarea(), { target: { value: '/' } });
    const listbox = screen.getByRole('listbox', { name: 'Chat modes' });
    expect(listbox.querySelectorAll('[role="option"]').length).toBe(SLASH_ITEMS.length);
  });

  it('keeps slash discovery in parity with the canonical mode catalog', () => {
    expect(SLASH_ITEMS.map(item => item.command)).toEqual(
      CHAT_DISCOVERABLE_MODES.map(mode => mode.id),
    );
  });

  it('arrow keys move the active option and Enter inserts the command', () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        streaming={false}
        files={[]}
        onFilesChange={() => {}}
        onSend={onSend}
        onStop={() => {}}
      />,
    );
    fireEvent.change(textarea(), { target: { value: '/' } });
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' });
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    expect(textarea().value).toBe(`/${SLASH_ITEMS[1]?.command} `);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Escape closes the popover without closing the chat (stopPropagation)', () => {
    render(
      <ChatComposer
        streaming={false}
        files={[]}
        onFilesChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    fireEvent.change(textarea(), { target: { value: '/' } });
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('textarea has no combobox ARIA while the popover is closed', () => {
    render(
      <ChatComposer
        streaming={false}
        files={[]}
        onFilesChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    const ta = textarea();
    expect(ta.getAttribute('role')).toBeNull();
    expect(ta.getAttribute('aria-expanded')).toBe('false');
    expect(ta.hasAttribute('aria-activedescendant')).toBe(false);
    expect(ta.hasAttribute('aria-controls')).toBe(false);
  });

  it('textarea gets combobox ARIA wired to the highlighted option when the popover is open', () => {
    render(
      <ChatComposer
        streaming={false}
        files={[]}
        onFilesChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    fireEvent.change(textarea(), { target: { value: '/' } });
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' });

    const ta = textarea();
    const listbox = screen.getByRole('listbox', { name: 'Chat modes' });
    const activeOption = listbox.querySelector('[aria-selected="true"]') as HTMLElement;

    expect(ta.getAttribute('role')).toBe('combobox');
    expect(ta.getAttribute('aria-expanded')).toBe('true');
    expect(ta.getAttribute('aria-autocomplete')).toBe('list');
    expect(ta.getAttribute('aria-controls')).toBe(listbox.id);
    expect(listbox.id).toBeTruthy();
    expect(activeOption.id).toBeTruthy();
    expect(ta.getAttribute('aria-activedescendant')).toBe(activeOption.id);
  });

  it('renders draft chips with remove buttons and calls onFilesChange on remove', () => {
    const onFilesChange = vi.fn();
    const file = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    render(
      <ChatComposer
        streaming={false}
        files={[file]}
        onFilesChange={onFilesChange}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    expect(screen.getByText('cv.pdf')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remove cv.pdf'));
    expect(onFilesChange).toHaveBeenCalledWith([]);
  });

  it('keeps the attach button enabled while streaming (files can be queued)', () => {
    render(
      <ChatComposer
        streaming
        files={[]}
        onFilesChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    expect(screen.getByLabelText('Attach files')).toHaveProperty('disabled', false);
  });

  it('pasting files adds them via onFilesChange', () => {
    const onFilesChange = vi.fn();
    render(
      <ChatComposer
        streaming={false}
        files={[]}
        onFilesChange={onFilesChange}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(paste, { clipboardData: { files: [file] } });
    fireEvent(textarea(), paste);
    expect(onFilesChange).toHaveBeenCalledWith([file]);
  });

  it('accepts file pastes while streaming (they queue for the next send)', () => {
    const onFilesChange = vi.fn();
    render(
      <ChatComposer
        streaming
        files={[]}
        onFilesChange={onFilesChange}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(paste, { clipboardData: { files: [file] } });
    fireEvent(textarea(), paste);
    expect(onFilesChange).toHaveBeenCalledWith([file]);
  });

  it('while streaming, Enter moves draft files into the queued-attachments slot', () => {
    useChatStore.setState({ activeConversationId: 'c1' });
    const onFilesChange = vi.fn();
    const file = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    render(
      <ChatComposer
        streaming
        files={[file]}
        onFilesChange={onFilesChange}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    fireEvent.change(textarea(), { target: { value: 'read this' } });
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    // Text + file both land in their queue slots; the live draft chips clear.
    expect(useChatStore.getState().queuedMessages.c1).toBe('read this');
    expect(useChatStore.getState().queuedAttachments.c1).toEqual([file]);
    expect(onFilesChange).toHaveBeenCalledWith([]);
  });

  it('renders queued attachment chips under the Queued hint with a remove control', () => {
    const file = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    useChatStore.setState({
      activeConversationId: 'c1',
      queuedAttachments: { c1: [file] },
    });
    render(
      <ChatComposer
        streaming
        files={[]}
        onFilesChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );
    expect(screen.getByText('Queued — sends when the reply finishes')).toBeTruthy();
    expect(screen.getByText('cv.pdf')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remove cv.pdf'));
    expect(useChatStore.getState().queuedAttachments).toEqual({});
  });

  it('allows a file-only send (empty text) when files are attached', () => {
    const onSend = vi.fn();
    const file = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    render(
      <ChatComposer
        streaming={false}
        files={[file]}
        onFilesChange={() => {}}
        onSend={onSend}
        onStop={() => {}}
      />,
    );
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('', []);
  });

  it('@ opens the offers listbox, Enter inserts the mention, send carries referencedOffers', () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        streaming={false}
        files={[]}
        onFilesChange={() => {}}
        onSend={onSend}
        onStop={() => {}}
      />,
    );
    const ta = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'compare @lin', selectionStart: 12 } });
    expect(screen.getByRole('listbox', { name: 'Offers' })).toBeTruthy();
    fireEvent.keyDown(ta, { key: 'Enter' }); // selects the highlighted offer
    expect(ta.value).toBe('compare @Linear #48 ');
    fireEvent.keyDown(ta, { key: 'Enter' }); // sends
    expect(onSend).toHaveBeenCalledWith('compare @Linear #48', [48]);
  });
});

describe('filterSlashItems', () => {
  it('empty filter returns the full list', () => {
    expect(filterSlashItems('')).toHaveLength(SLASH_ITEMS.length);
  });
  it('prefix matches rank first', () => {
    const out = filterSlashItems('tr');
    expect(out.map(i => i.command)).toEqual(['tracker', 'training']);
  });
  it('substring matches follow prefix matches', () => {
    const out = filterSlashItems('e');
    expect(out[0].command).toBe('enrich'); // prefix
    expect(out.map(i => i.command)).toContain('screen'); // substring
  });
});
