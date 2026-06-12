import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { useZodForm } from '../use-zod-form';

describe('useZodForm', () => {
  it('surfaces validation errors from the Zod schema', async () => {
    const schema = z.object({
      name: z.string().min(1, 'Name required'),
      email: z.string().email('Invalid email'),
    });

    // Destructure formState.errors inside the render callback so RHF
    // subscribes to error updates during renders.
    const { result } = renderHook(() => {
      const form = useZodForm(schema, { defaultValues: { name: '', email: 'bad' } });
      const { errors } = form.formState; // subscribe during render
      return { form, errors };
    });

    let valid: boolean;
    await act(async () => {
      valid = await result.current.form.trigger();
    });

    expect(valid!).toBe(false);
    expect(result.current.errors.name?.message).toBe('Name required');
    expect(result.current.errors.email?.message).toBe('Invalid email');
  });

  it('passes validation when inputs match schema', async () => {
    const schema = z.object({
      name: z.string().min(1),
      email: z.string().email(),
    });

    const { result } = renderHook(() => {
      const form = useZodForm(schema, { defaultValues: { name: 'Alice', email: 'a@b.co' } });
      const { errors } = form.formState;
      return { form, errors };
    });

    let valid: boolean;
    await act(async () => {
      valid = await result.current.form.trigger();
    });

    expect(valid!).toBe(true);
    expect(result.current.errors.name).toBeUndefined();
    expect(result.current.errors.email).toBeUndefined();
  });

  it('infers form values from schema type', () => {
    const schema = z.object({
      age: z.number().min(18),
      name: z.string(),
    });

    const { result } = renderHook(() =>
      useZodForm(schema, { defaultValues: { age: 25, name: 'Bob' } }),
    );

    // TypeScript inference: result.current.getValues() is typed { age: number; name: string }
    const values = result.current.getValues();
    expect(values.age).toBe(25);
    expect(values.name).toBe('Bob');
  });
});
