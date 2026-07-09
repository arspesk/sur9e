'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentPropsWithoutRef, ElementRef } from 'react';
import { forwardRef } from 'react';
import { useBottomChromeCollisionPadding } from '@/hooks/use-floating-anchor';
import { cn } from '@/lib/cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverPortal = PopoverPrimitive.Portal;

export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, sideOffset = 4, ...rest }, ref) {
  // Reserve the visible fixed bottom chrome (mobile nav etc.) so Radix
  // flips/constrains the popup above it instead of sliding underneath.
  // Callers can still override via an explicit collisionPadding (spread wins).
  const collisionPadding = useBottomChromeCollisionPadding();
  return (
    <PopoverPortal>
      <PopoverPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn('popover-content', className)}
        {...rest}
      />
    </PopoverPortal>
  );
});

export const PopoverArrow = forwardRef<
  ElementRef<typeof PopoverPrimitive.Arrow>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Arrow>
>(function PopoverArrow({ className, ...rest }, ref) {
  return <PopoverPrimitive.Arrow ref={ref} className={cn('popover-arrow', className)} {...rest} />;
});
