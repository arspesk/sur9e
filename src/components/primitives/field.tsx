import { createContext, type ReactNode, useContext, useId } from 'react';
import { cn } from '@/lib/cn';
import { ErrorText } from './error-text';
import { HelperText } from './helper-text';
import { Label } from './label';

/**
 * Context shared between Field and its child Input (or Textarea / Select).
 * Input reads `errorId` to set aria-describedby and `required` to set
 * aria-required on the control (WCAG 3.3.2 / fix #17).
 */
export interface FieldContextValue {
  /** id of the <ErrorText> rendered by Field, or undefined when no error. */
  errorId?: string;
  /** Mirrors Field's required prop so the control can set aria-required. */
  required?: boolean;
}

export const FieldContext = createContext<FieldContextValue>({});

export function useFieldContext(): FieldContextValue {
  return useContext(FieldContext);
}

interface FieldProps {
  label?: ReactNode;
  helperText?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  /**
   * Opt out of the hardcoded `form-field` wrapper class. Use when the
   * consumer provides its own field layout chrome but still wants the
   * label / helper / error composition.
   */
  bare?: boolean;
}

export function Field({
  label,
  helperText,
  error,
  required,
  children,
  htmlFor,
  className,
  bare,
}: FieldProps) {
  const errorId = useId();
  const hasError = error !== undefined && error !== null && error !== '';

  const ctx: FieldContextValue = {
    errorId: hasError ? errorId : undefined,
    required,
  };

  return (
    <FieldContext.Provider value={ctx}>
      <div className={cn(!bare && 'form-field', className)}>
        {label !== undefined && (
          <Label htmlFor={htmlFor}>
            {label}
            {required && <span aria-hidden="true"> *</span>}
          </Label>
        )}
        {children}
        {helperText !== undefined && <HelperText>{helperText}</HelperText>}
        {hasError && <ErrorText id={errorId}>{error}</ErrorText>}
      </div>
    </FieldContext.Provider>
  );
}
