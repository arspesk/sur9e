import { zodResolver } from '@hookform/resolvers/zod';
import { type FieldValues, type UseFormProps, type UseFormReturn, useForm } from 'react-hook-form';
import type { core } from 'zod';

/**
 * Typed wrapper around react-hook-form's useForm that wires a Zod schema
 * as the resolver. The returned form is fully typed to the schema's inferred
 * shape — no manual generic parameter needed at the call site.
 *
 * Input and Output are kept independent so schemas with transforms (e.g.
 * z.coerce.number(), z.string().transform(...)) work without forcing the
 * form values to the transform's output shape. `TInput extends FieldValues`
 * is the form-state shape rhf manages; `TOutput` is what `handleSubmit`
 * yields after validation.
 *
 * Example:
 *   const schema = z.object({ name: z.string().min(1, 'Required') });
 *   const form = useZodForm(schema, { defaultValues: { name: '' } });
 *   form.formState.errors.name?.message // typed string | undefined
 */
export function useZodForm<TInput extends FieldValues, TOutput = TInput>(
  schema: core.$ZodType<TOutput, TInput>,
  options?: Omit<UseFormProps<TInput>, 'resolver'>,
): UseFormReturn<TInput> {
  return useForm<TInput>({
    ...options,
    // zodResolver's generic is inferred from the schema; the rhf resolver
    // signature is broad enough to accept it, but the inference chain here
    // (TInput ≠ TOutput) needs one local widening to land cleanly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
  });
}
