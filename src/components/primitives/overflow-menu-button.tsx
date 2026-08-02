import { Ellipsis, EllipsisVertical } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { IconButton, type IconButtonProps } from './icon-button';

export interface OverflowMenuButtonProps extends Omit<IconButtonProps, 'icon'> {
  orientation?: 'vertical' | 'horizontal';
}

/** Canonical trigger for overflow menus across every Sur9e surface. */
export const OverflowMenuButton = forwardRef<HTMLButtonElement, OverflowMenuButtonProps>(
  function OverflowMenuButton({ orientation = 'vertical', className, ...props }, ref) {
    const MenuIcon = orientation === 'horizontal' ? Ellipsis : EllipsisVertical;

    return (
      <IconButton
        ref={ref}
        className={cn('overflow-menu-btn', className)}
        icon={<MenuIcon className="menu-dots-icon" aria-hidden="true" />}
        {...props}
      />
    );
  },
);
