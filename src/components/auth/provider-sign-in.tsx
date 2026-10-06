"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export type SignInProvider = "google" | "snaptrade";

const PROVIDERS: { id: SignInProvider; label: string; hint: string }[] = [
  { id: "google", label: "Continue with Google", hint: "Look around first, then connect brokerages in Settings." },
  { id: "snaptrade", label: "Continue with SnapTrade", hint: "Already use SnapTrade? Sign in and share brokerages in one step." },
];

/**
 * Sign-in buttons. `callbackURL` is already checked by `safeNext` on the server, and again by Better Auth's
 * trusted-origin check. Failures come back to `/sign-in?error=...`.
 */
export function ProviderSignIn({ enabled, callbackURL }: { enabled: Record<SignInProvider, boolean>; callbackURL: string }) {
  const [pending, setPending] = useState<SignInProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: SignInProvider) {
    setPending(provider);
    setError(null);
    // On success the browser leaves for the provider, so only the error path needs to reset state.
    const { error } = await authClient.signIn.social({ provider, callbackURL, errorCallbackURL: "/sign-in" });
    if (error) {
      setError("Sign-in could not start. Try again.");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {PROVIDERS.map((provider) => (
        <div key={provider.id} className="flex flex-col gap-1.5">
          <Button
            variant="outline"
            disabled={!enabled[provider.id] || pending !== null}
            aria-busy={pending === provider.id}
            onClick={() => signIn(provider.id)}
          >
            {pending === provider.id && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {provider.label}
          </Button>
          <p className="text-caption text-muted-foreground">
            {enabled[provider.id] ? provider.hint : "Not configured on this server."}
          </p>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-caption text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
