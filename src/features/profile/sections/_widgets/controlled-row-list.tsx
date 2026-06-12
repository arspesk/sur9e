'use client';

// sections/_widgets/controlled-row-list.tsx
//
// rhf-Controller adapter around <RowList>. The same Controller body
// repeats 3× across profile sections (archetypes / proof_points /
// languages) — same onCellChange / onRemove / onAdd shape, only the row
// factory and column tuple differ. Lifting the adapter here cuts ~25
// LOC per use site.

import {
  type FieldPath,
  type FieldValues,
  type PathValue,
  useController,
  useFormContext,
} from 'react-hook-form';
import { RowList } from './row-list';

interface ControlledRowListProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  R extends Record<string, string>,
> {
  /** rhf field name — value must be R[]. */
  name: TName;
  /** RowList kind discriminator (selects per-row Select option set). */
  kind: 'archetype' | 'proof_point' | 'language';
  /** Column tuple — keys of R, in render order. */
  cols: ReadonlyArray<keyof R & string>;
  /** Factory for a fresh empty row when the user clicks "+ Add …". */
  newRow: () => R;
  /** Label for the add button (e.g. "+ Add archetype"). */
  addLabel: string;
}

export function ControlledRowList<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  R extends Record<string, string>,
>({ name, kind, cols, newRow, addLabel }: ControlledRowListProps<TFieldValues, TName, R>) {
  const { control } = useFormContext<TFieldValues>();
  const {
    field: { value, onChange },
  } = useController({ name, control });
  const rows = (value ?? []) as R[];
  return (
    <RowList<Record<string, string>>
      path={name}
      kind={kind}
      cols={cols as ReadonlyArray<string>}
      rows={rows as unknown as Array<Record<string, string>>}
      onCellChange={(idx, col, v) => {
        const next = [...rows];
        next[idx] = { ...next[idx], [col]: v } as R;
        onChange(next as unknown as PathValue<TFieldValues, TName>);
      }}
      onRemove={idx => {
        const next = [...rows];
        next.splice(idx, 1);
        onChange(next as unknown as PathValue<TFieldValues, TName>);
      }}
      onAdd={() => {
        onChange([...rows, newRow()] as unknown as PathValue<TFieldValues, TName>);
      }}
      addLabel={addLabel}
    />
  );
}
