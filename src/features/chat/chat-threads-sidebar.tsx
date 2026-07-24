'use client';

// Permanent thread list for the /chat page — the same data and actions as the
// bubble header's SessionMenu popover (rename / archive / delete / new chat),
// laid out as an always-visible sidebar.

import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useDeleteConfirmStore } from '@/components/delete-confirm-modal';
import { KebabActionsMenu, type KebabItem } from '@/components/domain/kebab-actions-menu';
import {
  useArchiveSession,
  useChatSessions,
  useDeleteSession,
  useRenameSession,
} from '@/hooks/use-chat-sessions';
import type { Conversation } from '@/lib/schemas/chat';
import { useChatStore } from '@/stores/chat-store';

const ICON = { size: 15, strokeWidth: 1.8 } as const;

/** Per-row ⋮ trigger + its portaled actions menu. Own open state per row. */
function RowKebab({ label, items }: { label: string; items: KebabItem[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="chat-threads__kebab"
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        onClick={() => setOpen(o => !o)}
      >
        ⋮
      </button>
      {open && (
        <KebabActionsMenu
          items={items}
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
          ariaLabel={`Actions for ${label}`}
          className="chat-session-kebab-menu"
        />
      )}
    </>
  );
}

export function ChatThreadsSidebar() {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const activeId = useChatStore(s => s.activeConversationId);
  const setActiveConversation = useChatStore(s => s.setActiveConversation);
  const unread = useChatStore(s => s.unreadConversationIds);
  const { data: conversations } = useChatSessions();
  const rename = useRenameSession();
  const remove = useDeleteSession();
  const archive = useArchiveSession();
  const confirmDelete = useDeleteConfirmStore(s => s.confirm);

  const recent = (conversations ?? [])
    .filter(c => !c.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const archived = (conversations ?? [])
    .filter(c => c.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  function startRename(c: Conversation) {
    setRenamingId(c.id);
    setDraftTitle(c.title);
  }

  function commitRename() {
    if (renamingId && draftTitle.trim())
      rename.mutate({ id: renamingId, title: draftTitle.trim() });
    setRenamingId(null);
  }

  function onArchive(c: Conversation, next: boolean) {
    archive.mutate(
      { id: c.id, archived: next },
      {
        onSuccess: () => {
          if (next && activeId === c.id) setActiveConversation(null);
        },
      },
    );
  }

  async function onDelete(c: Conversation) {
    const ok = await confirmDelete({
      title: 'Delete chat?',
      // Override the modal's default (offer-delete) body — deleting a chat
      // touches neither the Offers list nor any report file.
      bodyText: 'This chat and all its messages will be permanently deleted.',
      target: c.title || 'Untitled chat',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    remove.mutate(c.id, {
      onSuccess: () => {
        if (activeId === c.id) setActiveConversation(null);
      },
    });
  }

  function kebabItems(c: Conversation): KebabItem[] {
    if (c.archived) {
      return [
        {
          label: 'Unarchive',
          icon: <ArchiveRestore {...ICON} />,
          onClick: () => onArchive(c, false),
        },
        {
          label: 'Delete',
          icon: <Trash2 {...ICON} />,
          danger: true,
          onClick: () => void onDelete(c),
        },
      ];
    }
    return [
      { label: 'Rename', icon: <Pencil {...ICON} />, onClick: () => startRename(c) },
      { label: 'Archive', icon: <Archive {...ICON} />, onClick: () => onArchive(c, true) },
      {
        label: 'Delete',
        icon: <Trash2 {...ICON} />,
        danger: true,
        onClick: () => void onDelete(c),
      },
    ];
  }

  function row(c: Conversation) {
    return (
      <div key={c.id} className="chat-threads__row" data-active={c.id === activeId || undefined}>
        {renamingId === c.id ? (
          <input
            className="chat-threads__rename"
            value={draftTitle}
            autoFocus
            aria-label="Rename chat"
            onChange={e => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setRenamingId(null);
              }
            }}
          />
        ) : (
          <>
            <button
              type="button"
              className="chat-threads__open"
              aria-current={c.id === activeId ? 'true' : undefined}
              onDoubleClick={() => startRename(c)}
              onClick={() => setActiveConversation(c.id)}
            >
              {c.title || 'Untitled chat'}
              {unread.includes(c.id) && (
                <>
                  <span className="chat-session-dot" aria-hidden="true" />
                  <span className="sr-only"> — new reply</span>
                </>
              )}
            </button>
            <RowKebab label={c.title || 'chat'} items={kebabItems(c)} />
          </>
        )}
      </div>
    );
  }

  return (
    <nav className="chat-threads" aria-label="Chat threads">
      <button
        type="button"
        className="chat-threads__new"
        onClick={() => setActiveConversation(null)}
        disabled={activeId === null}
      >
        <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
        New chat
      </button>
      <div className="chat-threads__group">Recent</div>
      {recent.map(row)}
      {recent.length === 0 && <p className="chat-threads__empty">No chats yet</p>}
      {archived.length > 0 && (
        <details className="chat-threads__archived">
          <summary className="chat-threads__group chat-threads__archived-summary">
            Archived ({archived.length})
          </summary>
          {archived.map(row)}
        </details>
      )}
    </nav>
  );
}
