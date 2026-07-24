'use client';

// Permanent thread list for the /chat page — the same data and actions as the
// bubble header's SessionMenu popover (rename / archive / delete / new chat),
// laid out as an always-visible raised panel.
//
// The visual language is deliberately the session dropdown's, unrolled: the
// "+" chip New-chat button, the divider under it, the filled accent active
// row, the hover wash, the reveal-on-hover ⋮ kebab and the archived <details>
// all mirror `.chat-session-menu*` (see app/styles/chat-threads.css) so the
// two thread surfaces can never drift apart visually.

import {
  Archive,
  ArchiveRestore,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
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

/** Collapsed-strip persistence — same localStorage pattern as the workspace
 * rail's `sur9e.hifi.rail` (components/shell/rail-nav.tsx). */
const COLLAPSE_KEY = 'sur9e.chat.threads-collapsed';

const DAY_MS = 86_400_000;

interface ThreadGroup {
  label: string;
  items: Conversation[];
}

/** Bucket threads by their `updatedAt` ISO timestamp into Today / Yesterday /
 * Previous 7 days / Older, relative to the viewer's local midnight. Empty
 * buckets are dropped so a header never renders without rows. Unparseable
 * timestamps fall into "Older" rather than disappearing. */
function groupByRecency(list: Conversation[], now: number): ThreadGroup[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const todayStart = midnight.getTime();

  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const week: Conversation[] = [];
  const older: Conversation[] = [];

  for (const c of list) {
    const t = Date.parse(c.updatedAt);
    if (!Number.isFinite(t) || t < todayStart - 7 * DAY_MS) older.push(c);
    else if (t >= todayStart) today.push(c);
    else if (t >= todayStart - DAY_MS) yesterday.push(c);
    else week.push(c);
  }

  return [
    { label: 'Today', items: today },
    { label: 'Yesterday', items: yesterday },
    { label: 'Previous 7 days', items: week },
    { label: 'Older', items: older },
  ].filter(g => g.items.length > 0);
}

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
  // Collapsed starts false on BOTH the server render and the first client
  // render (so hydration matches), then the mount effect swaps in the
  // persisted value — same deferral trick ChatEmptyState uses for its
  // time-of-day greeting. `ready` lands one frame later so restoring a
  // collapsed panel on load doesn't animate the width transition.
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const activeId = useChatStore(s => s.activeConversationId);
  const setActiveConversation = useChatStore(s => s.setActiveConversation);
  const unread = useChatStore(s => s.unreadConversationIds);
  const { data: conversations } = useChatSessions();
  const rename = useRenameSession();
  const remove = useDeleteSession();
  const archive = useArchiveSession();
  const confirmDelete = useDeleteConfirmStore(s => s.confirm);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Storage blocked (private mode / disabled cookies) — stay expanded.
    }
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Storage blocked — the toggle still works for this session.
      }
      return next;
    });
  }

  const recent = (conversations ?? [])
    .filter(c => !c.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const archived = (conversations ?? [])
    .filter(c => c.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const groups = groupByRecency(recent, Date.now());

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
    <nav
      className="chat-threads"
      aria-label="Chat threads"
      data-collapsed={collapsed || undefined}
      data-ready={ready || undefined}
    >
      <div className="chat-threads__head">
        <button
          type="button"
          className="chat-threads__new"
          onClick={() => setActiveConversation(null)}
          disabled={activeId === null}
          title={collapsed ? 'New chat' : undefined}
        >
          <span className="chat-threads__new-chip" aria-hidden="true">
            <Plus size={14} strokeWidth={2.4} />
          </span>
          <span className="chat-threads__new-label">New chat</span>
        </button>
        <button
          type="button"
          className="chat-threads__collapse"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="chat-threads-list"
          aria-label={collapsed ? 'Expand thread list' : 'Collapse thread list'}
          title={collapsed ? 'Expand thread list' : 'Collapse thread list'}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={16} strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="chat-threads__divider" role="presentation" />
      <div className="chat-threads__list" id="chat-threads-list">
        {groups.map(g => (
          <Fragment key={g.label}>
            <div className="chat-threads__group">{g.label}</div>
            {g.items.map(row)}
          </Fragment>
        ))}
        {recent.length === 0 && <p className="chat-threads__empty">No chats yet</p>}
        {archived.length > 0 && (
          <details className="chat-threads__archived">
            <summary className="chat-threads__group chat-threads__archived-summary">
              Archived ({archived.length})
            </summary>
            {archived.map(row)}
          </details>
        )}
      </div>
    </nav>
  );
}
