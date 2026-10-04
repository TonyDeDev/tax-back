import Link from "next/link";
import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2 font-display text-subheading font-semibold", className)}>
      <span aria-hidden className="size-2 rounded-sm bg-primary" />
      TaxBack
    </Link>
  );
}
