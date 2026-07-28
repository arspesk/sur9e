import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useOverflowFade } from '@/hooks/use-overflow-fade';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function Harness({ title = 'Thread title' }: { title?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useOverflowFade(ref, title);
  return <span ref={ref}>{title}</span>;
}

describe('useOverflowFade', () => {
  it('adds the fade marker only while the element is horizontally clipped', () => {
    const { container } = render(<Harness />);
    const title = container.querySelector('span') as HTMLSpanElement;
    Object.defineProperties(title, {
      clientWidth: { configurable: true, value: 80 },
      scrollWidth: { configurable: true, value: 140 },
    });

    act(() => window.dispatchEvent(new Event('resize')));
    expect(title).toHaveClass('is-clipped');

    Object.defineProperty(title, 'scrollWidth', { configurable: true, value: 80 });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(title).not.toHaveClass('is-clipped');
  });

  it('remeasures when the title content changes without a box resize', () => {
    const { container, rerender } = render(<Harness title="Short" />);
    const title = container.querySelector('span') as HTMLSpanElement;
    Object.defineProperties(title, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 100 },
    });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(title).not.toHaveClass('is-clipped');

    Object.defineProperty(title, 'scrollWidth', { configurable: true, value: 180 });
    rerender(<Harness title="A renamed title that now overflows" />);
    expect(title).toHaveClass('is-clipped');
  });
});
