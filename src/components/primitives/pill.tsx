import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  status?: string;
  children: ReactNode;
  className?: string;
}

function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/\s+/g, '');
}

export function Pill({ status, children, className, ...rest }: PillProps) {
  const statusKey = status ? normalizeStatus(status) : undefined;
  return (
    <span className={cn('pill', statusKey && `pill-${statusKey}`, className)} {...rest}>
      {children}
    </span>
  );
}
