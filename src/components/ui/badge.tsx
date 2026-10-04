import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-caption font-medium", {
  variants: {
    variant: {
      default: "bg-muted text-muted-foreground",
      outline: "bg-transparent text-muted-foreground",
      positive: "border-positive/40 bg-positive/10 text-positive",
      negative: "border-negative/40 bg-negative/10 text-negative",
    },
  },
  defaultVariants: { variant: "default" },
});

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
