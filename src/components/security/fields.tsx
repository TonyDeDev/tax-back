import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const control =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-body-sm text-foreground tabular-nums disabled:opacity-50";

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

/** A labelled form control with an optional hint below it. */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-caption font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />;
}

export function SelectInput({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, "px-2", className)} {...props} />;
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-caption text-negative">
      {message}
    </p>
  );
}
