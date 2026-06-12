import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';

// jsdom doesn't implement pointer-event helpers Radix Select relies on for
// keyboard/click open. Polyfill the bits that are missing.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

describe('Select', () => {
  it('renders the trigger with placeholder when no value is set', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Currency">
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="usd">USD</SelectItem>
          <SelectItem value="eur">EUR</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'Currency' })).toBeInTheDocument();
    expect(screen.getByText('Pick one')).toBeInTheDocument();
  });

  it('renders options when defaultOpen', () => {
    render(
      <Select defaultOpen>
        <SelectTrigger aria-label="Currency">
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="usd">USD</SelectItem>
          <SelectItem value="eur">EUR</SelectItem>
        </SelectContent>
      </Select>,
    );
    // The trigger's value slot also renders the option text once selected,
    // so we filter to the listbox option role to avoid duplicates.
    expect(screen.getByRole('option', { name: 'USD' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'EUR' })).toBeInTheDocument();
  });

  it('fires onValueChange when an option is selected', () => {
    const onValueChange = vi.fn();
    render(
      <Select defaultOpen onValueChange={onValueChange}>
        <SelectTrigger aria-label="Currency">
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="usd">USD</SelectItem>
          <SelectItem value="eur">EUR</SelectItem>
        </SelectContent>
      </Select>,
    );
    // Radix Select listens for pointer events; fireEvent emits both PointerEvent
    // (Radix path) and the synthetic click that follows.
    const option = screen.getByRole('option', { name: 'EUR' });
    fireEvent.pointerDown(option, { button: 0, ctrlKey: false });
    fireEvent.pointerUp(option, { button: 0, ctrlKey: false });
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenCalledWith('eur');
  });

  it('applies form-input + select-trigger classes by default', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Currency" data-testid="trig">
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="usd">USD</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByTestId('trig');
    expect(trigger.className).toContain('form-input');
    expect(trigger.className).toContain('select-trigger');
  });

  it('omits form-input base class when bare=true', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Currency" data-testid="trig" bare className="custom">
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="usd">USD</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByTestId('trig');
    expect(trigger.className).not.toContain('form-input');
    expect(trigger.className).not.toContain('select-trigger');
    expect(trigger.className).toContain('custom');
  });

  it('applies is-invalid + aria-invalid when invalid=true', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Currency" data-testid="trig" invalid>
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="usd">USD</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByTestId('trig');
    expect(trigger.className).toContain('is-invalid');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
  });

  it('forwards a ref to the trigger', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Select>
        <SelectTrigger aria-label="Currency" ref={ref}>
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="usd">USD</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(ref.current).not.toBeNull();
    // The trigger is rendered as a <button> by Radix Select.
    expect(ref.current?.tagName.toLowerCase()).toBe('button');
  });

  it('applies select-content + select-item classes to popup', () => {
    render(
      <Select defaultOpen>
        <SelectTrigger aria-label="Currency">
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent data-testid="content">
          <SelectItem data-testid="item" value="usd">
            USD
          </SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByTestId('content').className).toContain('select-content');
    expect(screen.getByTestId('item').className).toContain('select-item');
  });
});
