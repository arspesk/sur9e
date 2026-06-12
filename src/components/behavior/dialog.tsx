import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ElementRef } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...rest }, ref) {
  return <DialogPrimitive.Overlay ref={ref} className={cn('modal-overlay', className)} {...rest} />;
});

interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  hideClose?: boolean;
  /**
   * Focus the primary action button (`.btn-primary`) on open instead of
   * Radix's default (the first focusable, usually Cancel). Opt-in —
   * confirm-to-run modals (evaluate, research, …) set this so the run button
   * is the default action. DESTRUCTIVE confirms (delete) must NOT set it.
   */
  autoFocusPrimary?: boolean;
  /**
   * Element to return focus to when the dialog closes. Use this when the
   * dialog is opened programmatically (controlled, no DialogTrigger) from a
   * menu item that unmounts on open — Radix's automatic restore captures
   * `<body>` in that case, so the keyboard user loses their place. Passing the
   * opener (e.g. a row's kebab trigger) restores focus to it deterministically
   * on Escape / Cancel / overlay-close. Ignored when null/undefined.
   */
  returnFocus?: HTMLElement | null;
}

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent(
  {
    className,
    children,
    hideClose,
    autoFocusPrimary,
    returnFocus,
    onOpenAutoFocus,
    onCloseAutoFocus,
    ...rest
  },
  ref,
) {
  const handleOpenAutoFocus = autoFocusPrimary
    ? (e: Event) => {
        const root = e.currentTarget as HTMLElement | null;
        const primary = root?.querySelector<HTMLElement>('.btn-primary');
        if (primary) {
          e.preventDefault();
          primary.focus();
        }
        onOpenAutoFocus?.(e);
      }
    : onOpenAutoFocus;
  // Deterministically restore focus to the opener when one is supplied. Radix
  // captures its restore target as activeElement-at-mount, which is <body> for
  // controlled dialogs opened from a menu item that unmounts on open — so we
  // override it here. preventDefault stops Radix's (body) restore, then we
  // focus the opener ourselves.
  const handleCloseAutoFocus =
    returnFocus != null
      ? (e: Event) => {
          e.preventDefault();
          returnFocus.focus();
          onCloseAutoFocus?.(e);
        }
      : onCloseAutoFocus;
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        // Radix 1.1+ relies on aria-hidden on siblings (hideOthers) for AT
        // dialog containment and omits aria-modal. Some screen readers still
        // honor aria-modal, so set it explicitly as belt-and-suspenders.
        aria-modal
        className={cn('modal-content', className)}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        {...rest}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close asChild>
            <button type="button" className="modal-close" aria-label="Close">
              <X size={16} />
            </button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...rest }, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn('modal-title', className)} {...rest} />;
});

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...rest }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('modal-description', className)}
      {...rest}
    />
  );
});
