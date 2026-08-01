import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CmdkSlashMenu } from '../cmdk-slash-menu';
import type { SlashItem } from '../slash-registry';

const items: SlashItem[] = Array.from({ length: 8 }, (_, index) => ({
  id: `item-${index}`,
  group: 'Basic blocks',
  label: `Item ${index}`,
  command: () => {},
}));

describe('CmdkSlashMenu', () => {
  let originalScrollIntoView: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  });

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      delete (Element.prototype as { scrollIntoView?: Element['scrollIntoView'] }).scrollIntoView;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('scrolls the keyboard-active item into view when the index changes', async () => {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const { rerender } = render(
      <CmdkSlashMenu query="" activeIndex={0} onSelect={() => {}} items={items} />,
    );
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    scrollIntoView.mockClear();

    rerender(<CmdkSlashMenu query="" activeIndex={7} onSelect={() => {}} items={items} />);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
    const lastContext = scrollIntoView.mock.contexts.at(-1) as Element;
    expect(lastContext.textContent).toContain('Item 7');
  });
});
