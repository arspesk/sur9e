'use client';

// components/primitives/select.tsx
//
// Radix-backed <Select> primitive. Replaces native <select> consumers so the
// dropdown popup follows the app theme (light/dark) — native <select> popups
// are rendered by the OS and cannot be themed.
//
// Trigger renders with the same `form-input` chrome as <Input>, including:
//   - border, radius, padding, font, height
//   - `bare` opt-out (mirrors <Input>)
//   - `invalid` -> `is-invalid` + aria-invalid
//   - chevron icon injected via the existing <SelectIcon>
//
// Content + Item are portalled (Radix default) so the popup isn't clipped by
// overflow:hidden ancestors, and a custom CSS class chain (.select-content /
// .select-item / .select-label / .select-separator) styles them with the same
// CSS-var tokens as the rest of the chrome.

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';
import { forwardRef } from 'react';
import { useBottomChromeCollisionPadding } from '@/hooks/use-floating-anchor';
import { cn } from '@/lib/cn';

/* --------------------------------- Root --------------------------------- */

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;
export const SelectPortal = SelectPrimitive.Portal;

/* -------------------------------- Trigger ------------------------------- */

type SelectTriggerProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
  invalid?: boolean;
  /**
   * Opt out of the hardcoded `form-input` base class. Use when the trigger
   * needs bespoke chrome (e.g. inline / bare contexts). `is-invalid` still
   * applies when `invalid` is true.
   */
  bare?: boolean;
  /** Optional override for the chevron icon. Defaults to Lucide ChevronDown. */
  iconSlot?: ReactNode;
};

const ChevronIcon = <ChevronDown aria-hidden="true" />;

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(function SelectTrigger({ className, invalid, bare, iconSlot, children, ...rest }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(!bare && 'form-input select-trigger', invalid && 'is-invalid', className)}
      {...rest}
    >
      <span className="select-trigger__value">{children}</span>
      <SelectPrimitive.Icon className="select-trigger__icon" asChild>
        {iconSlot ?? ChevronIcon}
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

/* -------------------------------- Content ------------------------------- */

type SelectContentProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Content>;

export const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  SelectContentProps
>(function SelectContent(
  { className, position = 'popper', sideOffset = 4, children, ...rest },
  ref,
) {
  // Reserve the visible fixed bottom chrome (mobile nav etc.) so Radix
  // flips/constrains the popup above it instead of sliding underneath
  // (the nav's --z-bottom-bar outranks the popup's z tier). Callers can
  // still override via an explicit collisionPadding prop (spread wins).
  const collisionPadding = useBottomChromeCollisionPadding();
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn('select-content', className)}
        {...rest}
      >
        <SelectPrimitive.ScrollUpButton className="select-scroll-button">
          <ChevronUp aria-hidden="true" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="select-viewport">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="select-scroll-button">
          <ChevronDown aria-hidden="true" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

/* --------------------------------- Item --------------------------------- */

type SelectItemProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Item>;

export const SelectItem = forwardRef<ElementRef<typeof SelectPrimitive.Item>, SelectItemProps>(
  function SelectItem({ className, children, ...rest }, ref) {
    return (
      <SelectPrimitive.Item ref={ref} className={cn('select-item', className)} {...rest}>
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        <SelectPrimitive.ItemIndicator className="select-item__indicator">
          <Check aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </SelectPrimitive.Item>
    );
  },
);

/* -------------------------------- Label --------------------------------- */

type SelectLabelProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Label>;

export const SelectLabel = forwardRef<ElementRef<typeof SelectPrimitive.Label>, SelectLabelProps>(
  function SelectLabel({ className, ...rest }, ref) {
    return <SelectPrimitive.Label ref={ref} className={cn('select-label', className)} {...rest} />;
  },
);

/* ------------------------------- Separator ------------------------------ */

type SelectSeparatorProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>;

export const SelectSeparator = forwardRef<
  ElementRef<typeof SelectPrimitive.Separator>,
  SelectSeparatorProps
>(function SelectSeparator({ className, ...rest }, ref) {
  return (
    <SelectPrimitive.Separator ref={ref} className={cn('select-separator', className)} {...rest} />
  );
});
