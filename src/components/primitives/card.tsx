import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type CardPadding = 'sm' | 'md' | 'lg';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  interactive?: boolean;
  children: ReactNode;
  className?: string;
}

export function Card({ padding, interactive, children, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'card',
        padding && `card--p-${padding}`,
        interactive && 'card--interactive',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
