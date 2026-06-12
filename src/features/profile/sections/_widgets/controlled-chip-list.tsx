'use client';

// sections/_widgets/controlled-chip-list.tsx
//
// rhf-Controller adapter around <ChipList>. Same pattern as
// ControlledRowList — collapses the 3+ Controller+ChipList sites
// (search.terms, search.locations, narrative.superpowers).

import {
  type FieldPath,
  type FieldValues,
  type PathValue,
  useController,
  useFormContext,
} from 'react-hook-form';
import { ChipList } from './chip-list';

interface ControlledChipListProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  name: TName;
  inputId: string;
  inputPlaceholder: string;
  hint?: string;
}

export function ControlledChipList<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({ name, inputId, inputPlaceholder, hint }: ControlledChipListProps<TFieldValues, TName>) {
  const { control } = useFormContext<TFieldValues>();
  const {
    field: { value, onChange },
  } = useController({ name, control });
  const values = (value ?? []) as string[];
  return (
    <ChipList
      path={name}
      values={values}
      inputId={inputId}
      inputPlaceholder={inputPlaceholder}
      hint={hint}
      onAdd={val => onChange([...values, val] as unknown as PathValue<TFieldValues, TName>)}
      onRemove={idx => {
        const next = [...values];
        next.splice(idx, 1);
        onChange(next as unknown as PathValue<TFieldValues, TName>);
      }}
    />
  );
}
