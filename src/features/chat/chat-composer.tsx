'use client';

import { ArrowUp, FileText, Plus, Square, TextQuote, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Textarea } from '@/components/primitives';
import { useToastStore } from '@/components/toast/toast-store';
import { useApplications } from '@/hooks/use-applications';
import {
  CHAT_UPLOAD_ACCEPT,
  CHAT_UPLOAD_MAX_FILES,
  validateChatFiles,
} from '@/lib/chat/upload-allowlist';
import { conversationKey, useChatStore } from '@/stores/chat-store';
import {
  filterMentionItems,
  type MentionItem,
  MentionPopover,
  mentionOptionId,
} from './mention-popover';
import { ModelChip } from './model-chip';
import { filterSlashItems, SlashPopover, slashOptionId } from './slash-popover';

const LINE_HEIGHT_PX = 20;
const MAX_ROWS = 6;
const VERTICAL_PADDING_PX = 16;

/** Stable empty-array identity for the queued-attachments selector — a fresh
 * `[]` per render would defeat zustand's Object.is equality and re-render
 * forever. */
const EMPTY_FILES: File[] = [];

/** Composer: auto-growing textarea (1–6 rows), Enter sends / Shift+Enter
 * newline, '/' at position 0 opens the keyboard-driven slash popover, '@'
 * anywhere opens the offers mention popover. The input stays enabled during
 * streaming — Enter then queues both the message text (queuedMessages slot)
 * and any attached files (queuedAttachments slot), and the card sends them
 * together after 'done'. Attachments can be added mid-stream (paperclip,
 * paste, and the card's drop target all stay live while streaming). */
export function ChatComposer({
  streaming,
  sendDisabled = false,
  files,
  onFilesChange,
  onSend,
  onStop,
  onSendNow,
}: {
  streaming: boolean;
  /** Keep the draft editable while preventing it from being sent to a thread
   * whose messages have not resolved yet. */
  sendDisabled?: boolean;
  /** Draft attachments (state lives in ChatCard — the drop target). */
  files: File[];
  onFilesChange: (files: File[]) => void;
  onSend: (text: string, referencedOffers: number[]) => void;
  onStop: () => void;
  /** Stop the in-flight reply and dispatch the queued content immediately
   * (issue #105). Only rendered while a reply is actually streaming. */
  onSendNow?: () => void;
}) {
  const [value, setValue] = useState('');
  const pushToast = useToastStore(s => s.push);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const activeConversationId = useChatStore(s => s.activeConversationId);
  const queuedMessage = useChatStore(
    s => s.queuedMessages[conversationKey(s.activeConversationId)] ?? null,
  );
  const queuedAttachments = useChatStore(
    s => s.queuedAttachments[conversationKey(s.activeConversationId)] ?? EMPTY_FILES,
  );
  const setQueuedMessage = useChatStore(s => s.setQueuedMessage);
  const setQueuedAttachments = useChatStore(s => s.setQueuedAttachments);
  // On-screen text selections (Part 2) — rendered as removable chips in the
  // same row as file attachments, sent as context by the card's send path.
  const selections = useChatStore(s => s.selections);
  const removeSelection = useChatStore(s => s.removeSelection);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Restore a HELD queued message + attachments into the composer. A follow-up
  // queued behind a turn that finished while the chat was closed (or otherwise
  // detached) is never auto-sent — the watcher/probe leave it in the slots.
  // When there's no reply streaming, pull it into the composer as an editable
  // draft (text into the input, files back into the draft chips) so sending is
  // an explicit act. During streaming the slots are a real queue (the card
  // auto-sends them on 'done' while open) and are left alone. Reading `value`
  // and `files` through refs keeps this off the per-keystroke path and
  // preserves anything the user is already typing/attaching.
  const valueRef = useRef(value);
  valueRef.current = value;
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => {
    if (streaming) return;
    const hasQueuedText = queuedMessage != null;
    const hasQueuedFiles = queuedAttachments.length > 0;
    if (!hasQueuedText && !hasQueuedFiles) return;
    const key = conversationKey(activeConversationId);
    if (hasQueuedText && !valueRef.current) {
      setValue(queuedMessage);
      setQueuedMessage(key, null);
      taRef.current?.focus();
    }
    if (hasQueuedFiles) {
      onFilesChange([...filesRef.current, ...queuedAttachments].slice(0, 8));
      setQueuedAttachments(key, null);
    }
  }, [
    streaming,
    queuedMessage,
    queuedAttachments,
    activeConversationId,
    setQueuedMessage,
    setQueuedAttachments,
    onFilesChange,
  ]);

  function addFiles(list: FileList | File[]) {
    const { accepted, message } = validateChatFiles(Array.from(list), files.length);
    if (message) pushToast('warning', message);
    if (accepted.length > 0) {
      onFilesChange([...files, ...accepted].slice(0, CHAT_UPLOAD_MAX_FILES));
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    // File pastes are accepted mid-reply too — they land in the draft chips and
    // Enter queues them (see submit) to send once the current reply finishes.
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
    }
  }

  const slashFilter = value.startsWith('/') && !value.includes(' ') ? value.slice(1) : null;
  const slashItems = slashFilter != null ? filterSlashItems(slashFilter) : [];
  const showSlash = slashOpen && slashFilter != null && slashItems.length > 0;
  const activeOptionId = showSlash ? slashOptionId(listboxId, slashIndex) : undefined;

  const [mentionFilter, setMentionFilter] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionMapRef = useRef(new Map<string, number>());
  const mentionListboxId = useId();
  const { data: applications } = useApplications();
  const mentionItems =
    mentionFilter != null ? filterMentionItems(applications?.entries ?? [], mentionFilter) : [];
  const showMention = !showSlash && mentionFilter != null && mentionItems.length > 0;

  function autoGrow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_ROWS * LINE_HEIGHT_PX + VERTICAL_PADDING_PX)}px`;
  }

  function submit() {
    if (sendDisabled) return;
    const text = value.trim();
    if (!text && files.length === 0) return;
    // Mentions surviving the user's edits (their inserted string is still in
    // the text) become the referenced offer nums, deduped, then the map resets
    // for the next message.
    const referencedOffers = [
      ...new Set(
        [...mentionMapRef.current.entries()]
          .filter(([mention]) => text.includes(mention))
          .map(([, num]) => num),
      ),
    ];
    mentionMapRef.current.clear();
    if (streaming) {
      // Mid-stream: text and any attached files both queue (parallel store
      // slots), flushed together after the current reply's 'done'. The draft
      // chips move into the queued-attachments slot so they render under the
      // "Queued" hint rather than as a live draft.
      const key = conversationKey(activeConversationId);
      if (text) setQueuedMessage(key, text);
      if (files.length > 0) {
        setQueuedAttachments(key, files);
        onFilesChange([]);
      }
    } else onSend(text, referencedOffers);
    setValue('');
    setSlashOpen(false);
    setMentionFilter(null);
    setMentionStart(null);
    requestAnimationFrame(autoGrow);
  }

  function insertSlash(command: string) {
    setValue(`/${command} `);
    setSlashOpen(false);
    taRef.current?.focus();
  }

  function insertMention(item: MentionItem) {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? value.length;
    const start = mentionStart ?? caret;
    const mention = `@${item.company} #${item.num}`;
    mentionMapRef.current.set(mention, item.num);
    setValue(`${value.slice(0, start)}${mention} ${value.slice(caret)}`);
    setMentionFilter(null);
    setMentionStart(null);
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = start + mention.length + 1;
      ta?.setSelectionRange(pos, pos);
      autoGrow();
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showSlash) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex(i => (i + 1) % slashItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(i => (i - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        insertSlash(slashItems[slashIndex].command);
        return;
      }
      if (e.key === 'Escape') {
        // Close the popover only — the card's Escape handler must not fire.
        e.stopPropagation();
        setSlashOpen(false);
        return;
      }
    }
    if (showMention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(i => (i + 1) % mentionItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(i => (i - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionItems[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation(); // close the popover only, keep the card open
        setMentionFilter(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    setSlashIndex(0);
    setSlashOpen(next.startsWith('/') && !next.includes(' '));
    // Caret-anchored '@' detection: an '@' word (no spaces) ending at the
    // caret opens the offers popover with everything after '@' as filter.
    const caret = e.target.selectionStart ?? next.length;
    const m = /(^|\s)@([^\s@]*)$/.exec(next.slice(0, caret));
    setMentionFilter(m ? m[2] : null);
    setMentionStart(m ? caret - m[2].length - 1 : null);
    setMentionIndex(0);
    autoGrow();
  }

  return (
    <div className="chat-composer">
      {showSlash && (
        <SlashPopover
          items={slashItems}
          activeIndex={slashIndex}
          onSelect={insertSlash}
          listboxId={listboxId}
        />
      )}
      {showMention && (
        <MentionPopover
          items={mentionItems}
          activeIndex={mentionIndex}
          onSelect={insertMention}
          listboxId={mentionListboxId}
        />
      )}
      {(queuedMessage != null || queuedAttachments.length > 0) && (
        <div className="chat-composer__queued">
          <div className="chat-composer__queued-row">
            <span>Queued — sends when the reply finishes</span>
            {streaming && onSendNow && (
              <button
                type="button"
                className="chat-composer__queued-send"
                aria-label="Send now"
                title="Stop the current reply and send this now"
                onClick={onSendNow}
              >
                Send now
              </button>
            )}
            <button
              type="button"
              className="chat-composer__queued-clear"
              aria-label="Clear queued message"
              onClick={() => {
                const key = conversationKey(activeConversationId);
                setQueuedMessage(key, null);
                setQueuedAttachments(key, null);
              }}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          {queuedAttachments.length > 0 && (
            <AttachChips
              files={queuedAttachments}
              onRemove={i =>
                setQueuedAttachments(
                  conversationKey(activeConversationId),
                  queuedAttachments.filter((_, j) => j !== i),
                )
              }
            />
          )}
        </div>
      )}
      <form
        className="chat-composer__box"
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept={CHAT_UPLOAD_ACCEPT}
          onChange={e => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {/* Selection + attachment previews live INSIDE the box, above the
            textarea. Selections carry the same chip look as files (a distinct
            quote glyph marks them apart) and stack in the same row. */}
        {selections.length > 0 && (
          <SelectionChips selections={selections} onRemove={removeSelection} />
        )}
        {files.length > 0 && (
          <AttachChips
            files={files}
            onRemove={i => onFilesChange(files.filter((_, j) => j !== i))}
          />
        )}
        <Textarea
          ref={taRef}
          bare
          className="chat-composer__input"
          rows={1}
          value={value}
          placeholder="Ask anything — type / for modes…"
          aria-label="Message"
          role={showSlash || showMention ? 'combobox' : undefined}
          aria-expanded={showSlash || showMention}
          aria-controls={showSlash ? listboxId : showMention ? mentionListboxId : undefined}
          aria-activedescendant={
            showSlash
              ? activeOptionId
              : showMention
                ? mentionOptionId(mentionListboxId, mentionIndex)
                : undefined
          }
          aria-autocomplete={showSlash || showMention ? 'list' : undefined}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="chat-composer__tools">
          <button
            type="button"
            className="chat-composer__attach"
            aria-label="Attach files"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus aria-hidden="true" />
          </button>
          <span className="chat-composer__tools-spacer" />
          <ModelChip />
          {streaming ? (
            <button
              type="button"
              className="chat-composer__stop"
              aria-label="Stop reply"
              title="Stop reply"
              onClick={onStop}
            >
              <Square aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              className="chat-composer__send"
              aria-label="Send message"
              // Empty (no text, no attachments) → muted + not clickable; the
              // orange active look and hover come back the moment there's
              // something to send. Styling lives in .chat-composer__send[:disabled].
              disabled={sendDisabled || (value.trim().length === 0 && files.length === 0)}
            >
              <ArrowUp aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** File preview chips (image thumb or file icon, name, size, remove). Shared by
 * the live draft row (inside the box) and the queued-attachments row (under the
 * "Queued" hint) so both look identical. */
function AttachChips({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  return (
    <div className="chat-attach-chips">
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="chat-attach-chip">
          {f.type.startsWith('image/') ? (
            <img
              className="chat-attach-chip__thumb"
              src={URL.createObjectURL(f)}
              alt=""
              onLoad={e => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
            />
          ) : (
            <span className="chat-attach-chip__icon" aria-hidden="true">
              <FileText />
            </span>
          )}
          <span className="chat-attach-chip__name">{f.name}</span>
          <span className="chat-attach-chip__size">{Math.max(1, Math.round(f.size / 1024))}KB</span>
          <button
            type="button"
            className="chat-attach-chip__remove"
            aria-label={`Remove ${f.name}`}
            onClick={() => onRemove(i)}
          >
            <X aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** One-line preview for a selection chip — collapse internal whitespace and
 * trim so multi-line selections render as a single tidy label (CSS ellipsis
 * clamps the width). */
function selectionPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Captured-selection chip. Same chip chrome as AttachChips (so a selection
 * looks like a file attachment) but marked with a distinct lucide TextQuote
 * glyph instead of the file icon, and a truncated text preview instead of a
 * name + size. At most one is staged at a time — a new selection replaces it —
 * so the map renders 0 or 1 chip. */
function SelectionChips({
  selections,
  onRemove,
}: {
  selections: string[];
  onRemove: (index: number) => void;
}) {
  return (
    <div className="chat-attach-chips chat-selection-chips">
      {selections.map((text, i) => {
        const preview = selectionPreview(text);
        return (
          <span key={`${preview}-${i}`} className="chat-attach-chip chat-selection-chip">
            <span className="chat-attach-chip__icon" aria-hidden="true">
              <TextQuote />
            </span>
            <span className="chat-attach-chip__name" title={preview}>
              {preview}
            </span>
            <button
              type="button"
              className="chat-attach-chip__remove"
              aria-label={`Remove selection: ${preview.slice(0, 40)}`}
              onClick={() => {
                onRemove(i);
                // Drop the lingering page highlight so removing the chip fully
                // cancels the selection (and can't be re-captured).
                window.getSelection()?.removeAllRanges();
              }}
            >
              <X aria-hidden="true" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
