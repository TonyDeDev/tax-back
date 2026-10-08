import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge only knows Tailwind's default theme. Without these, it reads the theme.css type scale
 * (`text-body-sm`, ...) as text colors and drops it whenever a color such as `text-primary-foreground`
 * follows, so a filled button fell back to the 16px body size.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "body-sm", "body", "subheading", "heading-sm", "heading", "heading-lg", "display"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
