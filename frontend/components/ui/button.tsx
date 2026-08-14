"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Primary actions are near-black rather than the accent colour.
 *
 * That is the single decision doing most of the work in this product's visual
 * identity: it reads as considered rather than templated, and it leaves the
 * accent hue free to mean "this is active" — selected navigation, a focus ring,
 * the workflow rail — instead of competing with every button on the page.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium",
    "transition-[background-color,border-color,color,box-shadow] duration-150",
    // Radix `asChild` renders a link, which needs the same focus treatment.
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
    // `pointer-events-none` alone would let a disabled button still receive
    // focus; both are needed for it to be genuinely inert.
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-ink-900 text-white shadow-xs hover:bg-ink-800 active:bg-ink-950",
        secondary:
          "bg-surface text-ink-800 border border-border shadow-xs hover:bg-ink-50 hover:border-border-strong active:bg-ink-100",
        ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
        danger:
          "bg-danger-600 text-white shadow-xs hover:bg-danger-700 active:bg-danger-700",
        // For destructive actions that are not the page's main action — reads
        // as available rather than as a warning until hovered.
        dangerSubtle:
          "bg-surface text-danger-600 border border-danger-200 hover:bg-danger-50 hover:border-danger-600",
        link: "text-accent-600 underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-[13px] [&_svg]:size-3.5",
        md: "h-9 rounded-md px-3.5 text-sm [&_svg]:size-4",
        lg: "h-10 rounded-lg px-4 text-sm [&_svg]:size-4",
        // Square, for icon-only buttons. Always paired with an aria-label.
        icon: "size-9 rounded-md [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        // Announces the pending state to a screen reader, which a spinner alone
        // does not.
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            {/* The label stays rendered so the button does not change width
                mid-action, which moves everything beside it. */}
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);

Button.displayName = "Button";

export { buttonVariants };
