import type { InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { useFieldContext } from './field';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /**
   * Opt out of the hardcoded `form-input` base class. Use when migrating a
   * bespoke-styled input (search box, date picker, etc.) that should not
   * inherit the default field chrome. `is-invalid` is still applied so the
   * invalid state remains consumer-controllable.
   */
  bare?: boolean;
  /**
   * Optional leading icon (lucide element or inline SVG). Rendered
   * decorative (aria-hidden) inside the field; adds left padding via
   * `form-input--with-icon`. Never the only carrier of meaning.
   */
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    invalid,
    bare,
    icon,
    className,
    'aria-describedby': describedBy,
    'aria-required': ariaRequired,
    ...rest
  },
  ref,
) {
  const { errorId, required } = useFieldContext();

  // Merge any caller-supplied aria-describedby with the Field-provided errorId.
  const mergedDescribedBy = [describedBy, errorId].filter(Boolean).join(' ') || undefined;

  // aria-required: caller prop wins; fall back to Field context; omit when falsy.
  const mergedRequired = ariaRequired ?? (required || undefined);

  const inputEl = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      aria-describedby={mergedDescribedBy}
      aria-required={mergedRequired}
      className={cn(
        !bare && 'form-input',
        icon && 'form-input--with-icon',
        invalid && 'is-invalid',
        className,
      )}
      {...rest}
    />
  );
  if (!icon) return inputEl;
  return (
    <span className="form-input-iconwrap">
      <span className="form-input-iconwrap__icon" aria-hidden="true">
        {icon}
      </span>
      {inputEl}
    </span>
  );
});
