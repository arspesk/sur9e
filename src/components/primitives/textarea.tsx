import type { TextareaHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /**
   * Opt out of the hardcoded `form-input` base class. Use when the consumer
   * provides its own styling and shouldn't inherit the default field chrome.
   * `is-invalid` is still applied so the invalid state remains
   * consumer-controllable.
   */
  bare?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, bare, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(!bare && 'form-input', invalid && 'is-invalid', className)}
      {...rest}
    />
  );
});
