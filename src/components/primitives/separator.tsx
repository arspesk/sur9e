import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface SeparatorProps extends HTMLAttributes<HTMLHRElement> {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export function Separator({ orientation = 'horizontal', className, ...rest }: SeparatorProps) {
  return (
    <hr
      className={cn('separator', orientation === 'vertical' && 'separator--vertical', className)}
      {...rest}
    />
  );
}
