import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/server/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AppShell user={{ name: user.name, isDemo: user.isDemo }}>{children}</AppShell>;
}
