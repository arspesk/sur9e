'use client';

import { useState } from 'react';

const MAX_CHAT_FILES = 8;

/**
 * Shared file-drop behavior for the bubble card and full-page conversation.
 * Both surfaces feed the same draft-file state owned by useConversation.
 */
export function useChatFileDrop(setFiles: React.Dispatch<React.SetStateAction<File[]>>) {
  const [dragOver, setDragOver] = useState(false);

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
    setFiles(previous =>
      [...previous, ...Array.from(event.dataTransfer.files)].slice(0, MAX_CHAT_FILES),
    );
  }

  return { dragOver, onDragLeave, onDragOver, onDrop };
}
