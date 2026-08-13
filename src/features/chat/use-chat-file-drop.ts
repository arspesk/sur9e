'use client';

import { useState } from 'react';
import { useToastStore } from '@/components/toast/toast-store';
import { CHAT_UPLOAD_MAX_FILES, validateChatFiles } from '@/lib/chat/upload-allowlist';

/**
 * Shared file-drop behavior for the bubble card and full-page conversation.
 * Both surfaces feed the same draft-file state owned by useConversation.
 * Drops run through the SAME validator the picker/paste paths use so an
 * unsupported file is rejected before it stages (with a clear message) rather
 * than only failing after send (issue #73).
 */
export function useChatFileDrop(
  files: File[],
  setFiles: React.Dispatch<React.SetStateAction<File[]>>,
) {
  const [dragOver, setDragOver] = useState(false);
  const pushToast = useToastStore(s => s.push);

  function onDragOver(event: React.DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDragOver(true);
  }

  function onDragLeave(event: React.DragEvent<HTMLElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setDragOver(false);
  }

  function onDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragOver(false);
    const { accepted, message } = validateChatFiles(
      Array.from(event.dataTransfer.files),
      files.length,
    );
    if (message) pushToast('warning', message);
    if (accepted.length > 0) {
      setFiles(previous => [...previous, ...accepted].slice(0, CHAT_UPLOAD_MAX_FILES));
    }
  }

  return { dragOver, onDragLeave, onDragOver, onDrop };
}
