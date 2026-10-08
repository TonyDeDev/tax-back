import type { ReactNode } from "react";
import { AmountsProvider } from "@/components/amounts";
import { AppShell } from "@/components/shell/app-shell";
import { amountsHidden } from "@/server/amounts";
import { requireUser } from "@/server/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [user, hidden] = await Promise.all([requireUser(), amountsHidden()]);
  return (
    <AmountsProvider hidden={hidden}>
      <AppShell user={{ name: user.name, isDemo: user.isDemo }}>{children}</AppShell>
    </AmountsProvider>
  );
}
