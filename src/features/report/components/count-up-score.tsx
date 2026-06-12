'use client';

// Animated score numeral — counts from 0.0 to target over 800ms with a
// cubic ease-out. Runs once per mount + once per target change. Respects
// prefers-reduced-motion (no animation, render final value immediately).

import { useEffect, useState } from 'react';

interface CountUpScoreProps {
  target: number;
  className?: string;
  /** Duration in ms. Default 800 (matches legacy). */
  duration?: number;
}

export function CountUpScore({ target, className, duration = 800 }: CountUpScoreProps) {
  // Initial state = target so SSR + first client paint render identical
  // text (no hydration mismatch). After hydration the useEffect resets
  // to 0 + tweens up. This matches the legacy countUpNumeral flow (HTML
  // rendered with final value, JS reset to 0.0 + animated after load).
  const [display, setDisplay] = useState(target);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setDisplay(0);
      return;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target);
      return;
    }

    let raf = 0;
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(target * eased);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
      }
    }
    setDisplay(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return (
    <div className={className}>
      {display.toFixed(1)}
      <span className="denom">/5</span>
    </div>
  );
}
