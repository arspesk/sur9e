'use client';

import { Archive, ArchiveRestore, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { Fragment, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/behavior/popover';
import { useDeleteConfirmStore } from '@/components/delete-confirm-modal';
import { KebabActionsMenu, type KebabItem } from '@/components/domain/kebab-actions-menu';
import { OverflowMenuButton } from '@/components/primitives';
import {
  useArchiveSession,
  useChatSessions,
  useDeleteSession,
  useRenameSession,
} from '@/hooks/use-chat-sessions';
import { useOverflowFade } from '@/hooks/use-overflow-fade';
import type { Conversation } from '@/lib/schemas/chat';
import { useChatStore } from '@/stores/chat-store';
import { groupByRecency } from './thread-groups';

const ICON = { size: 15, strokeWidth: 1.8 } as const;

function SessionTitle({
  children,
  className = 'chat-session-menu__title',
}: {
  children: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useOverflowFade(ref, children);
  return (
    <span ref={ref} className={className}>
      {children}
    </span>
  );
}

/** Per-row ⋮ trigger + its portaled actions menu (rename / archive / delete).
 * Encapsulates its own open state + trigger ref so each row is independent. */
function SessionRowKebab({ label, items }: { label: string; items: KebabItem[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <OverflowMenuButton
        ref={triggerRef}
        className="chat-session-menu__kebab"
        label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        onClick={() => setOpen(o => !o)}
      />
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

/** Header session switcher: current title + ▾ caret opening the recent list,
 * 'New chat', and a per-row ⋮ menu (rename / archive / delete) that reuses the
 * app's shared KebabActionsMenu. Rename is inline (menu item or double-click);
 * delete routes through the app's standard delete-confirm modal. */
export function SessionMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
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

  const active = conversations?.find(c => c.id === activeId) ?? null;
  // No cap: the bubble and the /chat sidebar must list the same threads, or a
  // conversation reachable from one surface silently vanishes on the other.
  // The popover is already max-height: 320px with overflow-y: auto (chat.css),
  // so a long list scrolls rather than growing.
  const recent = (conversations ?? [])
    .filter(c => !c.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const archived = (conversations ?? [])
    .filter(c => c.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const groups = groupByRecency(recent, Date.now());

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

  function startRename(c: Conversation) {
    setRenamingId(c.id);
    setDraftTitle(c.title);
  }
  function commitRename() {
    if (renamingId && draftTitle.trim()) {
      rename.mutate({ id: renamingId, title: draftTitle.trim() });
    }
    setRenamingId(null);
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

  return (
    <Popover
      open={menuOpen}
      onOpenChange={o => {
        setMenuOpen(o);
        if (!o) setRenamingId(null);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="chat-session-trigger" aria-label="Switch chat session">
          <SessionTitle className="chat-header__title">{active?.title || 'Chat'}</SessionTitle>
          <ChevronDown
            className="chat-session-trigger__caret"
            size={16}
            strokeWidth={1.8}
            aria-hidden="true"
          />
          {unread.length > 0 && (
            <>
              <span className="chat-session-trigger__dot" aria-hidden="true" />
              <span className="sr-only">Unread replies</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="chat-session-menu"
        // The per-row ⋮ menu and the delete-confirm modal both portal OUT of
        // this popover to document.body — without this guard a click inside
        // either reads as an outside interaction and closes the session menu
        // before the action runs.
        onInteractOutside={e => {
          const t = e.target as Element | null;
          if (t?.closest?.('.actions-menu') || t?.closest?.('.delete-confirm-modal')) {
            e.preventDefault();
          }
        }}
      >
        {/* 'New chat' only clears the active conversation to null — a no-op
            when you're already on a fresh empty chat (activeId === null), so
            hide it (and its divider) in that state. */}
        {activeId !== null && (
          <>
            <button
              type="button"
              className="chat-session-menu__new"
              onClick={() => {
                setActiveConversation(null);
                setMenuOpen(false);
              }}
            >
              <span className="chat-session-menu__new-chip" aria-hidden="true">
                <Plus size={14} strokeWidth={2.4} />
              </span>
              <span className="chat-session-menu__new-label">New chat</span>
            </button>
            <div className="chat-session-menu__divider" role="presentation" />
          </>
        )}
        {groups.map(g => (
          <Fragment key={g.label}>
            <div className="chat-session-menu__group">{g.label}</div>
            {g.items.map(c => (
              <div
                key={c.id}
                className="chat-session-menu__row"
                data-active={c.id === activeId ? 'true' : undefined}
              >
                {renamingId === c.id ? (
                  <input
                    className="chat-session-menu__rename"
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
                      className="chat-session-menu__open"
                      onDoubleClick={() => startRename(c)}
                      onClick={() => {
                        setActiveConversation(c.id);
                        setMenuOpen(false);
                      }}
                    >
                      <SessionTitle>{c.title || 'Untitled chat'}</SessionTitle>
                      {unread.includes(c.id) && (
                        <>
                          <span className="chat-session-dot" aria-hidden="true" />
                          <span className="sr-only"> — new reply</span>
                        </>
                      )}
                    </button>
                    <SessionRowKebab
                      label={c.title || 'chat'}
                      items={[
                        {
                          label: 'Rename',
                          icon: <Pencil {...ICON} />,
                          onClick: () => startRename(c),
                        },
                        {
                          label: 'Archive',
                          icon: <Archive {...ICON} />,
                          onClick: () => onArchive(c, true),
                        },
                        {
                          label: 'Delete',
                          icon: <Trash2 {...ICON} />,
                          danger: true,
                          onClick: () => void onDelete(c),
                        },
                      ]}
                    />
                  </>
                )}
              </div>
            ))}
          </Fragment>
        ))}
        {recent.length === 0 && <p className="chat-session-menu__empty">No chats yet</p>}
        {archived.length > 0 && (
          <details className="chat-session-menu__archived">
            <summary className="chat-session-menu__archived-summary">
              Archived ({archived.length})
            </summary>
            {archived.map(c => (
              <div key={c.id} className="chat-session-menu__row">
                <SessionTitle className="chat-session-menu__archived-title">
                  {c.title || 'Untitled chat'}
                </SessionTitle>
                <SessionRowKebab
                  label={c.title || 'chat'}
                  items={[
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
                  ]}
                />
              </div>
            ))}
          </details>
        )}
      </PopoverContent>
    </Popover>
  );
}
