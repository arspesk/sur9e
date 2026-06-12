import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface ErrorTextProps extends HTMLAttributes<HTMLElement> {
  /**
   * Opt out of the hardcoded `form-field__error` base class. Use when the
   * consumer provides its own error styling.
   */
  bare?: boolean;
}

export function ErrorText({ bare, className, children, ...rest }: ErrorTextProps) {
  if (!children && children !== 0) return null;
  return (
    <small className={cn(!bare && 'form-field__error', className)} {...rest}>
      {children}
    </small>
  );
}
