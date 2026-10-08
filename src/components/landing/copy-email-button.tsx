"use client";

import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusDot } from "@/components/status-dot";

/** Copies an email address and says "Copied" with a green status dot for 1.5s. */
export function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={copied ? `Copied ${email}` : `Copy ${email}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(email);
          setCopied(true);
        } catch {
          // Clipboard access can be refused; the address stays visible to copy by hand.
        }
      }}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-caption text-muted-foreground transition-motion hover:border-border-strong hover:text-foreground"
    >
      {copied ? (
        <>
          <StatusDot tone="positive" className="animate-fade-in" />
          <span aria-live="polite">Copied</span>
        </>
      ) : (
        <>
          <Copy aria-hidden className="size-3.5" />
          Copy
        </>
      )}
    </button>
  );
}
