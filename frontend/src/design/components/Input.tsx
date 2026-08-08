/**
 * Input (blueprint §3.6).
 *
 * text · search · select · textarea. Label above, hint below, **error replaces
 * hint**. The focus ring uses `--ring` and is never removed.
 *
 * `<Field>` owns the label/hint/error structure so every input in the product
 * has the same anatomy and the same `aria-describedby` wiring.
 */

import { Search } from "lucide-react";
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------
   Field — the shared anatomy
   ---------------------------------------------------------------------- */

export interface FieldProps {
  label: string;
  /** Guidance below the control. Replaced by `error` when one is present. */
  hint?: ReactNode;
  /** The validation failure. Takes the hint's place, never stacks with it. */
  error?: string;
  required?: boolean;
  className?: string;
  children: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode;
}

export function Field({ label, hint, error, required = false, className, children }: FieldProps) {
  const inputId = useId();
  const messageId = `${inputId}-message`;
  const hasMessage = Boolean(error ?? hint);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="type-label text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        )}
      </label>

      {children({ inputId, describedBy: hasMessage ? messageId : undefined })}

      {hasMessage && (
        <p
          id={messageId}
          className={cn("type-caption", error ? "text-status-failed" : "text-ink-soft")}
          role={error ? "alert" : undefined}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Controls
   ---------------------------------------------------------------------- */

const CONTROL_CLASS =
  "w-full rounded-card border border-input bg-surface px-3 text-ink placeholder:text-ink-soft/70 " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

const INVALID_CLASS = "border-status-failed";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_CLASS, "type-body-sm h-9", invalid && INVALID_CLASS, className)}
      {...rest}
    />
  );
});

export const SearchInput = forwardRef<HTMLInputElement, TextInputProps>(function SearchInput(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-soft"
        strokeWidth={2}
      />
      <input
        ref={ref}
        type="search"
        aria-invalid={invalid || undefined}
        className={cn(CONTROL_CLASS, "type-body-sm h-9 pl-8", invalid && INVALID_CLASS, className)}
        {...rest}
      />
    </div>
  );
});

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(function SelectInput(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_CLASS, "type-body-sm h-9", invalid && INVALID_CLASS, className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export interface TextareaInputProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const TextareaInput = forwardRef<HTMLTextAreaElement, TextareaInputProps>(
  function TextareaInput({ className, invalid, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL_CLASS,
          "type-body-sm min-h-20 resize-y py-2",
          invalid && INVALID_CLASS,
          className,
        )}
        {...rest}
      />
    );
  },
);
