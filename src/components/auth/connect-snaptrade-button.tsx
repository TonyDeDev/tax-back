"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * Links SnapTrade to the signed-in account (for users who signed up with Google). The user approves read
 * access on SnapTrade's consent screen and comes back to Settings; failures come back as `?error=...`.
 */
export function ConnectSnapTradeButton({ disabled = false }: { disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setPending(true);
    setError(null);
    const { error } = await authClient.linkSocial({
      provider: "snaptrade",
      callbackURL: "/settings?connected=snaptrade",
      errorCallbackURL: "/settings",
    });
    if (error) {
      setError("SnapTrade could not be opened. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button size="sm" onClick={connect} disabled={disabled || pending} aria-busy={pending}>
        {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
        Connect with SnapTrade
      </Button>
      {error && (
        <p role="alert" className="text-caption text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
