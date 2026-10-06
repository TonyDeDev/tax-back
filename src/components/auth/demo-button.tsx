"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/** Signs the visitor in as the shared demo user, then opens the Hub. The button fills its wrapper. */
export function DemoButton({ className, size, variant, children = "Try the demo" }: ButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function start() {
    setError(null);
    startTransition(async () => {
      const { error } = await authClient.demo.signIn();
      if (error) {
        setError(
          error.status === 429 ? "Lots of visitors right now. Try again in a minute." : "The demo could not start. Try again.",
        );
        return;
      }
      router.push("/hub");
      router.refresh();
    });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Button size={size} variant={variant} className="w-full" onClick={start} disabled={pending} aria-busy={pending}>
        {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
        {children}
      </Button>
      {error && (
        <p role="alert" className="text-caption text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
