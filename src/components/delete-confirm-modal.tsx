'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { Button, IconButton } from '@/components/primitives';
import { useFocusTrap } from '@/hooks/use-focus-trap';

// ── Store ──

export interface DeleteConfirmOptions {
  num?: number;
  company?: string;
  count?: number;
  title?: string;
  target?: string;
  bodyText?: string;
  warningText?: string;
  confirmLabel?: string;
}

interface DeleteConfirmState {
  visible: boolean;
  options: DeleteConfirmOptions;
  _resolve: ((value: boolean) => void) | null;
  confirm: (opts?: DeleteConfirmOptions) => Promise<boolean>;
  _settle: (value: boolean) => void;
}

export const useDeleteConfirmStore = create<DeleteConfirmState>(set => ({
  visible: false,
  options: {},
  _resolve: null,
  confirm(opts = {}) {
    return new Promise<boolean>(resolve => {
      set({ visible: true, options: opts, _resolve: resolve });
    });
  },
  _settle(value) {
    set(s => {
      if (s._resolve) s._resolve(value);
      return { visible: false, _resolve: null };
    });
  },
}));

// ── Component ──

export function DeleteConfirmModal() {
  const { visible, options, _settle } = useDeleteConfirmStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, visible);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        _settle(false);
      }
      if (e.key === 'Enter') {
        // Focus lands on the Cancel button when the modal opens — let a
        // focused button's native Enter→click activation win, otherwise
        // Enter on Cancel (or the Close icon) would confirm the delete.
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement && dialogRef.current?.contains(active)) return;
        e.preventDefault();
        _settle(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, _settle]);

  // Focus cancel on open
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('.delete-confirm-modal__cancel')?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) return null;

  const {
    num,
    company,
    count,
    title,
    target: targetText,
    bodyText,
    warningText,
    confirmLabel,
  } = options;

  let titleStr = 'Delete offer?';
  if (title) titleStr = title;
  else if (typeof count === 'number' && count > 1) titleStr = `Delete ${count} offers?`;

  let targetStr: string;
  if (targetText != null) {
    targetStr = targetText;
  } else if (typeof count === 'number' && count > 1) {
    targetStr = `${count} selected offers`;
  } else {
    const parts: string[] = [];
    if (num != null) parts.push(`#${num}`);
    if (company) parts.push(company);
    targetStr = parts.join(' — ') || 'this offer';
  }

  const body =
    bodyText ?? 'The offer will be removed from your Offers list and the report file deleted.';
  const warning = warningText ?? 'This action cannot be undone.';
  const confirmBtnLabel = confirmLabel ?? 'Delete';

  return (
    <div className="delete-confirm-modal" id="delete-confirm-modal">
      <div
        className="delete-confirm-modal__backdrop"
        onClick={() => _settle(false)}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className="delete-confirm-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-modal-title"
      >
        <header className="delete-confirm-modal__head">
          <h2 id="delete-confirm-modal-title">{titleStr}</h2>
          <IconButton
            className="delete-confirm-modal__close"
            label="Close"
            onClick={() => _settle(false)}
            icon={<X size={16} />}
          />
        </header>
        <div className="delete-confirm-modal__body">
          <p>{body}</p>
          <div className="delete-confirm-modal__target">{targetStr}</div>
          <p className="delete-confirm-modal__warning">
            <AlertTriangle size={14} strokeWidth={1.8} aria-hidden="true" /> {warning}
          </p>
        </div>
        <footer className="delete-confirm-modal__foot">
          <Button
            variant="secondary"
            className="delete-confirm-modal__cancel"
            onClick={() => _settle(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            className="delete-confirm-modal__submit"
            onClick={() => _settle(true)}
          >
            {confirmBtnLabel}
          </Button>
        </footer>
      </div>
    </div>
  );
}
