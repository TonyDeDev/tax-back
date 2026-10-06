"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export interface ShellUser {
  name: string;
  isDemo: boolean;
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label="Sign out"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          router.push("/");
          router.refresh();
        })
      }
    >
      <LogOut aria-hidden className="size-4" />
    </Button>
  );
}

/** Who is signed in, with sign out. Initials rather than provider avatars keep images same-origin under the CSP. */
export function UserMenu({ user, className }: { user: ShellUser; className?: string }) {
  const name = user.isDemo ? "Demo visitor" : user.name;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-sm border bg-accent font-display text-body-sm font-semibold text-accent-foreground"
      >
        {initial(name)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-sm font-medium">{name}</span>
        <span className="text-caption text-muted-foreground">{user.isDemo ? "Read-only demo" : "Signed in"}</span>
      </div>
      <SignOutButton />
    </div>
  );
}
