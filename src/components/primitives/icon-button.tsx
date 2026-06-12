import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

type IconButtonVariant = 'default' | 'subtle' | 'danger';
type IconButtonSize = 'sm' | 'md' | 'lg';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'default', size = 'md', loading, disabled, className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      disabled={disabled || loading}
      aria-disabled={disabled || loading || undefined}
      className={cn(
        'icon-btn',
        variant !== 'default' && `icon-btn--${variant}`,
        `icon-btn--${size}`,
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
