import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading,
    leadingIcon,
    trailingIcon,
    disabled,
    className,
    children,
    type,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-disabled={disabled || loading || undefined}
      className={cn('btn', `btn-${variant}`, `btn-${size}`, className)}
      {...rest}
    >
      {leadingIcon && <span className="btn__icon btn__icon--leading">{leadingIcon}</span>}
      <span className="btn__label">{children}</span>
      {trailingIcon && <span className="btn__icon btn__icon--trailing">{trailingIcon}</span>}
    </button>
  );
});
