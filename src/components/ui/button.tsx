import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/*
 * Hover lifts the border one step (Basalt to Pewter) and the primary fill brightens; press scales to 0.98.
 * `group/button` lets a trailing arrow nudge 2px right on hover (`group-hover/button:translate-x-0.5`).
 */
export const buttonVariants = cva(
  "group/button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-body-sm font-medium transition-motion motion-safe:active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline: "border border-border bg-transparent text-foreground hover:border-border-strong hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        destructive: "border border-destructive bg-transparent text-destructive hover:bg-destructive/10",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3",
        lg: "h-11 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** The trailing glyph of a call to action: it moves 2px toward where the button goes. */
export const buttonArrowClass = "size-4 shrink-0 transition-motion motion-safe:group-hover/button:translate-x-0.5";
