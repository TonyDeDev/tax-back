import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-8">
        <Brand />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/sign-in" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-8 px-4 py-12 md:px-8">
        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="font-display text-heading font-bold md:text-heading-lg lg:text-display">
            All your brokerages. One Canadian tax picture.
          </h1>
          <p className="max-w-xl text-body text-muted-foreground">
            TaxBack pools your accounts, tracks adjusted cost base across brokerages, and flags superficial losses
            and tax-loss harvesting chances before they cost you.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          {/* Becomes a demo-login server action in the auth phase. */}
          <Link href="/hub" className={buttonVariants({ size: "lg" })}>
            Try the demo
          </Link>
          <Link href="/sign-in" className={buttonVariants({ variant: "outline", size: "lg" })}>
            Sign in
          </Link>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-caption text-muted-foreground md:px-8">
        Free concept demo for Canadian investors. Not tax advice. Check numbers with a professional.
      </footer>
    </div>
  );
}
