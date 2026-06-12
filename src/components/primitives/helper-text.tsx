import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface HelperTextProps extends HTMLAttributes<HTMLElement> {
  /**
   * Opt out of the hardcoded `form-field__hint` base class. Use when the
   * consumer provides its own hint styling.
   */
  bare?: boolean;
}

export function HelperText({ bare, className, children, ...rest }: HelperTextProps) {
  if (!children) return null;
  return (
    <small className={cn(!bare && 'form-field__hint', className)} {...rest}>
      {children}
    </small>
  );
}
