"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Copies a bare amount ("1234.56") for pasting into tax software, and confirms it for a moment. */
export function CopyAmount({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0"
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      title={copied ? "Copied" : "Copy the amount"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Clipboard access can be refused (an insecure origin, a denied permission); the amount stays visible to copy by hand.
        }
      }}
    >
      {copied ? <Check aria-hidden className="size-4 text-positive" /> : <Copy aria-hidden className="size-4" />}
    </Button>
  );
}
