import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';

describe('Popover', () => {
  it('renders content when defaultOpen', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>,
    );
    expect(screen.getByText('Popover body')).toBeInTheDocument();
  });

  it('applies popover-content class', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent data-testid="pc">Popover body</PopoverContent>
      </Popover>,
    );
    expect(screen.getByTestId('pc').className).toContain('popover-content');
  });

  it('does not render content when closed', () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Hidden body</PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText('Hidden body')).not.toBeInTheDocument();
  });
});
