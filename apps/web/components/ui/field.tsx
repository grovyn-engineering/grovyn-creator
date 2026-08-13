"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Form primitives.
 *
 * The label/description/error wiring is the whole point. Doing it by hand at
 * each call site is where accessible forms go wrong — a `<p>` that visually
 * looks like an error but is never announced, or an input whose label is not
 * programmatically associated. `Field` generates the ids and the
 * `aria-describedby` chain so every form in the product gets it right.
 */

interface FieldContextValue {
  id: string;
  descriptionId: string;
  errorId: string;
  hasError: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

function useField(): FieldContextValue {
  const context = React.useContext(FieldContext);
  if (!context) throw new Error("Field subcomponents must be used inside <Field>");
  return context;
}

export function Field({
  children,
  error,
  className,
}: {
  children: React.ReactNode;
  /** Present means invalid. Drives styling, `aria-invalid`, and the live region. */
  error?: string | undefined;
  className?: string;
}) {
  const id = React.useId();

  const value = React.useMemo(
    () => ({
      id,
      descriptionId: `${id}-description`,
      errorId: `${id}-error`,
      hasError: Boolean(error),
    }),
    [id, error]
  );

  return (
    <FieldContext.Provider value={value}>
      <div className={cn("space-y-1.5", className)}>
        {children}
        {error && (
          <p
            id={value.errorId}
            // Announced when it appears, without stealing focus. `polite` rather
            // than `assertive`: a validation message is not an emergency, and
            // assertive would interrupt whatever the user is typing.
            role="alert"
            aria-live="polite"
            className="text-[13px] text-danger-600"
          >
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

export function FieldLabel({
  children,
  optional,
  className,
}: {
  children: React.ReactNode;
  optional?: boolean;
  className?: string;
}) {
  const { id } = useField();
  return (
    <label htmlFor={id} className={cn("block text-[13px] font-medium text-ink-800", className)}>
      {children}
      {optional && <span className="ml-1.5 font-normal text-ink-400">optional</span>}
    </label>
  );
}

export function FieldDescription({ children }: { children: React.ReactNode }) {
  const { descriptionId } = useField();
  return (
    <p id={descriptionId} className="text-[13px] text-ink-500">
      {children}
    </p>
  );
}

const inputClasses = [
  "block w-full rounded-md border bg-surface px-3 text-sm text-ink-900",
  "placeholder:text-ink-400",
  "transition-[border-color,box-shadow] duration-150",
  "disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400",
].join(" ");

function stateClasses(hasError: boolean): string {
  return hasError
    ? "border-danger-600 focus-visible:outline-danger-600"
    : "border-border-strong hover:border-ink-400 focus-visible:outline-accent-500";
}

export const FieldInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  const { id, descriptionId, errorId, hasError } = useField();

  return (
    <input
      ref={ref}
      id={id}
      aria-invalid={hasError || undefined}
      // Points at whichever helper text exists. A screen reader reads the
      // description on focus and the error the moment it appears.
      aria-describedby={hasError ? errorId : descriptionId}
      className={cn(inputClasses, "h-9", stateClasses(hasError), className)}
      {...props}
    />
  );
});
FieldInput.displayName = "FieldInput";

export const FieldTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  const { id, descriptionId, errorId, hasError } = useField();

  return (
    <textarea
      ref={ref}
      id={id}
      aria-invalid={hasError || undefined}
      aria-describedby={hasError ? errorId : descriptionId}
      className={cn(inputClasses, "min-h-20 py-2 leading-6 resize-y", stateClasses(hasError), className)}
      {...props}
    />
  );
});
FieldTextarea.displayName = "FieldTextarea";

export const FieldSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => {
  const { id, descriptionId, errorId, hasError } = useField();

  return (
    <select
      ref={ref}
      id={id}
      aria-invalid={hasError || undefined}
      aria-describedby={hasError ? errorId : descriptionId}
      className={cn(inputClasses, "h-9 pr-8 appearance-none", stateClasses(hasError), className)}
      {...props}
    >
      {children}
    </select>
  );
});
FieldSelect.displayName = "FieldSelect";

/**
 * A form-wide error, for failures that belong to no single input — a 409 on
 * signup, an upstream provider failure. Without this, such errors either
 * vanish or get attached to an arbitrary field.
 */
export function FormError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2.5 text-[13px] text-danger-700"
    >
      {children}
    </div>
  );
}
