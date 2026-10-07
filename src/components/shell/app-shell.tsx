import type { ReactNode } from "react";
import { SignOutButton, type ShellUser } from "@/components/auth/user-menu";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { BottomNav } from "./bottom-nav";
import { Sidebar } from "./sidebar";

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  return (
    <div className="flex flex-1">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-card px-4 py-2 lg:hidden">
          <Brand />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-300 flex-1 flex-col gap-6 px-4 py-6 pb-24 md:px-8 md:py-8 lg:pb-8">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
