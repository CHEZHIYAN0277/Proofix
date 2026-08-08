/**
 * Button (blueprint §3.6).
 *
 * `primary` · `secondary` · `ghost` · `danger`; sizes `sm/md/lg`.
 *
 * Two contracts the type system enforces:
 *   - icon-only requires `aria-label`;
 *   - `loading` disables the button and swaps to a spinner — and is only ever
 *     bound to a **real pending operation**, never to a timer.
 *
 * The focus ring uses `--ring` and is never removed.
 */

import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 border-transparent",
  secondary: "bg-surface text-ink border-border hover:bg-surface-muted",
  ghost: "bg-transparent text-ink border-transparent hover:bg-surface-muted",
  danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90 border-transparent",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 gap-1.5 type-caption",
  md: "h-8 px-3 gap-2 type-label",
  lg: "h-10 px-4 gap-2 type-body-sm",
};

const ICON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "size-7 px-0",
  md: "size-8 px-0",
  lg: "size-10 px-0",
};

type BaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Bound to a real in-flight operation. Disables the button. */
  loading?: boolean;
  icon?: ReactNode;
  iconPosition?: "start" | "end";
};

/**
 * An icon-only button must name itself. Without a label it is invisible to a
 * screen reader, so the discriminated union makes it impossible to omit.
 */
export type DsButtonProps =
  | (BaseProps & { children: ReactNode; "aria-label"?: string })
  | (BaseProps & { children?: undefined; icon: ReactNode; "aria-label": string });

export const Button = forwardRef<HTMLButtonElement, DsButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    icon,
    iconPosition = "start",
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const iconOnly = children === undefined;
  const spinner = <Loader2 aria-hidden className="size-3.5 animate-spin" strokeWidth={2} />;
  const leading = loading ? spinner : iconPosition === "start" ? icon : null;
  const trailing = !loading && iconPosition === "end" ? icon : null;

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-card border font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // The focus ring is a design-system guarantee. Never removed.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
        VARIANT_CLASS[variant],
        iconOnly ? ICON_SIZE_CLASS[size] : SIZE_CLASS[size],
        className,
      )}
      style={{
        transitionDuration: "var(--motion-instant)",
        transitionTimingFunction: "var(--ease-instant)",
      }}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </button>
  );
});
