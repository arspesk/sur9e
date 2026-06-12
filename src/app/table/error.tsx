'use client';

import { useEffect } from 'react';
import { Button } from '@/components/primitives';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('[table] route error', error);
  }, [error]);

  return (
    <div className="route-error report-empty anim-enter" role="alert">
      <h1>Failed to load offers</h1>
      <p>{error.message}</p>
      <Button variant="secondary" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
