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
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';
import { forwardRef } from 'react';
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
  /** Optional override for the chevron icon. Defaults to a small chevron-down SVG. */
  iconSlot?: ReactNode;
};

const ChevronIcon = (
  <svg
    aria-hidden="true"
    width="10"
    height="6"
    viewBox="0 0 10 6"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <title>Chevron down</title>
    <path
      d="M1 1l4 4 4-4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

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
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={sideOffset}
        className={cn('select-content', className)}
        {...rest}
      >
        <SelectPrimitive.ScrollUpButton className="select-scroll-button">
          ▲
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="select-viewport">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="select-scroll-button">
          ▼
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
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Selected</title>
            <path
              d="M2.5 6L5 8.5L9.5 3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
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
