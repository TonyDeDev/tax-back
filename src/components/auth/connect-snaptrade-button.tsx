"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * Links SnapTrade to the signed-in account (for users who signed up with Google). The user approves read
 * access on SnapTrade's consent screen and comes back to Settings; failures come back as `?error=...`.
 */
interface ConnectSnapTradeButtonProps {
  disabled?: boolean;
  label?: string;
  /** Where SnapTrade sends the user back after approving. Failures always return to Settings, which explains them. */
  callbackURL?: string;
}

export function ConnectSnapTradeButton({
  disabled = false,
  label = "Connect with SnapTrade",
  callbackURL = "/settings?connected=snaptrade",
}: ConnectSnapTradeButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setPending(true);
    setError(null);
    const { error } = await authClient.linkSocial({
      provider: "snaptrade",
      callbackURL,
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
        {label}
      </Button>
      {error && (
        <p role="alert" className="text-caption text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
