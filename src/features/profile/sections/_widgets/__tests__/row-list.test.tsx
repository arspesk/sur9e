import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { RowList } from '../row-list';

// Harness that holds row state the way ControlledRowList does, so a cell
// edit re-renders RowList with the updated row value — reproducing the
// real focus-retention condition.
function Harness() {
  const [rows, setRows] = useState<Array<Record<string, string>>>([
    { name: '', level: '', fit: '' },
  ]);
  return (
    <RowList
      path="target_roles.archetypes"
      kind="archetype"
      cols={['name', 'level', 'fit']}
      rows={rows}
      onCellChange={(idx, col, v) =>
        setRows(prev => {
          const next = [...prev];
          next[idx] = { ...next[idx], [col]: v };
          return next;
        })
      }
      onRemove={() => {}}
      onAdd={() => {}}
      addLabel="+ Add archetype"
    />
  );
}

describe('RowList focus retention', () => {
  it('keeps focus on the name input after a keystroke updates the row value', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    // Typing a character updates row.name → RowList re-renders. With an
    // unstable value-derived key the input remounts and loses focus.
    fireEvent.change(input, { target: { value: 'S' } });

    const after = screen.getByLabelText('Name') as HTMLInputElement;
    expect(after.value).toBe('S');
    expect(document.activeElement).toBe(after); // fails if the input remounted
  });
});
