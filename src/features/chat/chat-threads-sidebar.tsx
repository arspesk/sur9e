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

import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
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
const THREAD_WIDTH_STORAGE_KEY = 'sur9e.chat.thread-width';
const DEFAULT_THREAD_WIDTH = 256;
const MIN_THREAD_WIDTH = 220;
const MAX_THREAD_WIDTH = 360;
const KEYBOARD_RESIZE_STEP = 8;

function clampThreadWidth(value: number): number {
  return Math.min(MAX_THREAD_WIDTH, Math.max(MIN_THREAD_WIDTH, Math.round(value)));
}

/** Per-row ⋮ trigger + its portaled actions menu. Own open state per row. */
function RowKebab({ label, items }: { label: string; items: KebabItem[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <OverflowMenuButton
        ref={triggerRef}
        className="chat-threads__kebab"
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

function ThreadTitle({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useOverflowFade(ref, children);
  return (
    <span ref={ref} className="chat-threads__title">
      {children}
    </span>
  );
}

export function ChatThreadsSidebar() {
  const navRef = useRef<HTMLElement>(null);
  const widthRef = useRef(DEFAULT_THREAD_WIDTH);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [threadWidth, setThreadWidth] = useState(DEFAULT_THREAD_WIDTH);
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
  const groups = groupByRecency(recent, Date.now());

  function applyThreadWidth(nextWidth: number, persist = false) {
    const clamped = clampThreadWidth(nextWidth);
    widthRef.current = clamped;
    setThreadWidth(clamped);
    if (persist) localStorage.setItem(THREAD_WIDTH_STORAGE_KEY, String(clamped));
  }

  useEffect(() => {
    const saved = Number.parseInt(localStorage.getItem(THREAD_WIDTH_STORAGE_KEY) ?? '', 10);
    if (Number.isFinite(saved)) applyThreadWidth(saved);
  }, []);

  useEffect(() => {
    navRef.current?.parentElement?.style.setProperty('--chat-thread-width', `${threadWidth}px`);
  }, [threadWidth]);

  useEffect(
    () => () => {
      document.body.style.cursor = '';
    },
    [],
  );

  function startResize(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: widthRef.current,
    };
  }

  function moveResize(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    applyThreadWidth(drag.startWidth + e.clientX - drag.startX);
  }

  function finishResize(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    e.currentTarget.classList.remove('dragging');
    document.body.style.cursor = '';
    dragRef.current = null;
    localStorage.setItem(THREAD_WIDTH_STORAGE_KEY, String(widthRef.current));
  }

  function resizeWithKeyboard(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    applyThreadWidth(
      widthRef.current + (e.key === 'ArrowLeft' ? -KEYBOARD_RESIZE_STEP : KEYBOARD_RESIZE_STEP),
      true,
    );
  }

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
              <ThreadTitle>{c.title || 'Untitled chat'}</ThreadTitle>
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
    <>
      <nav ref={navRef} className="chat-threads" aria-label="Chat threads">
        <div className="chat-threads__head">
          <button
            type="button"
            className="chat-threads__new"
            onClick={() => setActiveConversation(null)}
            disabled={activeId === null}
          >
            <span className="chat-threads__new-chip" aria-hidden="true">
              <Plus size={14} strokeWidth={2.4} />
            </span>
            <span className="chat-threads__new-label">New chat</span>
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
      <button
        type="button"
        role="separator"
        aria-label="Resize thread list"
        aria-orientation="vertical"
        aria-valuemin={MIN_THREAD_WIDTH}
        aria-valuemax={MAX_THREAD_WIDTH}
        aria-valuenow={threadWidth}
        className="chat-threads__resize"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={resizeWithKeyboard}
      />
    </>
  );
}
