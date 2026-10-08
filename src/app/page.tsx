import type { Metadata } from "next";
import { ArrowUpRight, Layers, Scissors, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DemoButton } from "@/components/auth/demo-button";
import { Brand } from "@/components/brand";
import { GithubIcon } from "@/components/icons/brand-icons";
import { CandleField } from "@/components/landing/candle-field";
import { OpenSourceSection } from "@/components/landing/open-source-section";
import { TeamCard } from "@/components/landing/team-card";
import { REPO_URL, linkRows, team } from "@/components/landing/team";
import { Reveal } from "@/components/motion/reveal";
import { StatusDot } from "@/components/status-dot";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";

export const metadata: Metadata = {
  title: "TaxBack - All your brokerages, one Canadian tax picture",
  description:
    "A free concept demo that pools your adjusted cost base across every brokerage and flags superficial losses and tax-loss harvesting under CRA rules.",
};

/** The rules behind the numbers, each anchored on the figure that defines it. */
const RULES = [
  { figure: "1 pool", label: "ACB per security, across every brokerage" },
  { figure: "30 days", label: "Superficial loss window, before and after" },
  { figure: "50%", label: "Capital gains inclusion rate" },
  { figure: "T+1", label: "Settlement decides the tax year" },
] as const;

/** The three things the engine does that a single broker cannot. */
const FEATURES = [
  {
    label: "The core problem",
    title: "ACB pooled across brokerages",
    icon: Layers,
    body: "Each broker sees only its own accounts, so none of them knows your real adjusted cost base. TaxBack replays every non-registered account into one pool.",
    spec: "ALL NON-REGISTERED · EVERY BROKERAGE",
  },
  {
    label: "The rule people miss",
    title: "Superficial losses, caught",
    icon: TriangleAlert,
    body: "Rebuy within 30 days and the loss is denied, even if the rebuy was in your TFSA. TaxBack moves the denied amount onto the replacement shares, or says when it is gone for good.",
    spec: "-30D … +30D · TFSA AND RRSP INCLUDED",
  },
  {
    label: "Before you sell",
    title: "Harvesting with the dates",
    icon: Scissors,
    body: "Positions worth less than their ACB, the gains each could offset, and the date before which buying back in any account would undo the whole thing.",
    spec: "SAFE SALE DATE · NO-REBUY DATE",
  },
] as const;

/*
 * The product as the hero, in the DESIGN.md console idiom: a real ACB audit trail in Red Hat Mono.
 * These figures come from the seeded demo portfolio, so what a visitor sees next matches this.
 */
const AUDIT_ROWS = [
  { date: "2024-04-15", event: "BUY", detail: "200 × 25.10", delta: "+5,024.95", pool: "200", acb: "5,024.95" },
  { date: "2024-09-02", event: "BUY", detail: "100 × 28.40", delta: "+2,840.00", pool: "300", acb: "7,864.95" },
  { date: "2025-01-20", event: "ROC", detail: "return of capital", delta: "-6.40", pool: "300", acb: "7,858.55" },
  { date: "2025-06-11", event: "SELL", detail: "120 × 31.05", delta: "-3,143.42", pool: "180", acb: "4,715.13" },
] as const;

/**
 * DESIGN.md separates sections with a hairline rather than spacing alone. Each section below the hero
 * fades up once as it scrolls into view, and its hairline draws in from the left.
 */
function Section({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <Reveal>
      <section aria-labelledby={label} className="relative py-12 md:py-16">
        <span data-hairline aria-hidden className="absolute inset-x-0 top-0 h-px bg-border" />
        {children}
      </section>
    </Reveal>
  );
}

function SectionHeading({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h2 id={id} className="font-display text-heading-sm font-medium md:text-heading">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 md:px-8">
        <Brand />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/sign-in" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

function AuditTrail() {
  return (
    <div className="overflow-hidden rounded-md border bg-card shadow-subtle">
      <div className="flex items-center justify-between gap-4 border-b bg-muted px-4 py-2">
        <span className="font-mono text-body-sm text-muted-foreground">ACB AUDIT TRAIL — XEQT</span>
        <span className="font-mono text-caption text-muted-foreground">POOLED · 2 BROKERAGES</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] font-mono text-body-sm tabular-nums">
          <caption className="sr-only">An example adjusted cost base audit trail for a pooled holding</caption>
          <thead className="text-caption text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className="px-4 py-2 text-left font-normal">
                Date
              </th>
              <th scope="col" className="px-4 py-2 text-left font-normal">
                Event
              </th>
              <th scope="col" className="px-4 py-2 text-right font-normal">
                ACB change
              </th>
              <th scope="col" className="px-4 py-2 text-right font-normal">
                Units
              </th>
              <th scope="col" className="px-4 py-2 text-right font-normal">
                Pooled ACB
              </th>
            </tr>
          </thead>
          <tbody>
            {AUDIT_ROWS.map((row) => (
              <tr key={row.date} className="border-b last:border-0">
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{row.date}</td>
                <td className="px-4 py-2">
                  <span className="text-foreground">{row.event}</span>{" "}
                  <span className="text-muted-foreground">{row.detail}</span>
                </td>
                <td className="px-4 py-2 text-right text-muted-foreground">{row.delta}</td>
                <td className="px-4 py-2 text-right text-muted-foreground">{row.pool}</td>
                <td className="px-4 py-2 text-right">{row.acb}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
        <span className="font-mono text-caption text-muted-foreground">SETTLED GAIN, 2025</span>
        <span className="font-mono text-body-sm tabular-nums text-positive">+583.68 CAD</span>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="flex flex-col gap-10 pb-12 md:pb-16">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-6">
        <div className="flex flex-col gap-6">
          <Tag className="self-start">Free concept demo · Canada only</Tag>
          <div className="flex max-w-3xl flex-col gap-4">
            <h1 className="font-display text-heading font-bold md:text-heading-lg xl:text-display">
              All your brokerages. One Canadian tax picture.
            </h1>
            <p className="max-w-xl text-body text-muted-foreground">
              TaxBack pools your adjusted cost base across every brokerage, catches superficial losses before they
              cost you, and lays your year out the way Schedule 3 asks for it.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <DemoButton size="lg" />
            <Link href="/sign-in" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Connect a brokerage
            </Link>
          </div>
          <p className="text-caption text-muted-foreground">
            The demo is a full seeded portfolio. No account, no brokerage, nothing to install.
          </p>
        </div>
        {/* Fixed heights, so the field never shifts the layout while it draws in. */}
        <CandleField className="-mx-4 h-48 sm:h-64 md:-mx-8 lg:mx-0 lg:h-[26rem]" />
      </div>
      {/* The product sits directly under the hero as the visual proof, per DESIGN.md's layout. */}
      <AuditTrail />
    </section>
  );
}

function Rules() {
  return (
    <Section>
      <dl className="grid grid-cols-2 gap-px bg-border md:grid-cols-4">
        {RULES.map(({ figure, label }) => (
          <div key={figure} className="flex flex-col gap-1 bg-background p-4 md:p-6">
            <dt className="font-display text-heading-sm font-semibold tabular-nums md:text-heading">{figure}</dt>
            <dd className="text-caption text-muted-foreground">{label}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function Features() {
  return (
    <Section label="what-it-does">
      <div className="flex flex-col gap-8">
        <SectionHeading id="what-it-does" title="What a single broker cannot tell you">
          <p className="text-body text-muted-foreground">
            Every number records the rule it applied and the Bank of Canada rate it used.
          </p>
        </SectionHeading>
        <ul className="grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ label, title, body, spec, icon: Icon }) => (
            <li key={title} className="flex flex-col gap-3 rounded-md border bg-card p-6 shadow-subtle">
              <div className="flex items-center gap-2">
                <Icon aria-hidden className="size-4 shrink-0 text-primary" />
                <span className="text-caption font-medium text-primary uppercase">{label}</span>
              </div>
              <h3 className="font-display text-heading-sm font-semibold">{title}</h3>
              <p className="flex-1 text-body-sm text-muted-foreground">{body}</p>
              <p className="border-t pt-3 font-mono text-caption text-muted-foreground">{spec}</p>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function OpenSource() {
  return (
    <Section label="open-source">
      <OpenSourceSection />
    </Section>
  );
}

function Contact() {
  return (
    <Section label="contact">
      <div className="flex flex-col gap-8">
        <div className="relative flex flex-col gap-3 pb-6">
          <span data-hairline aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-border" />
          <h2 id="contact" className="font-display text-heading-sm font-medium md:text-heading">
            Contact
          </h2>
          <p className="text-body text-muted-foreground">The people behind TaxBack. Say hello, or read the code.</p>
        </div>
        <ul className="reveal-stagger grid gap-4 [--motion-stagger:60ms] md:grid-cols-3">
          {team.map((member) => (
            <li key={member.name}>
              <TeamCard member={member} rows={linkRows(member.links)} />
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

export default async function Landing({ searchParams }: PageProps<"/">) {
  // Set by "Delete my data" in Settings, which signs the user out and lands here.
  const deleted = (await searchParams).deleted === "1";
  return (
    <div className="flex flex-1 flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-12 md:px-8 md:py-16">
        {deleted && (
          <p role="status" className="mb-8 flex items-center gap-2 rounded-md border px-4 py-3 text-body-sm">
            <StatusDot tone="positive" />
            Your TaxBack data was deleted and its SnapTrade access was revoked.
          </p>
        )}
        <Hero />
        <Rules />
        <Features />
        <OpenSource />
        <Contact />
      </main>
      <footer className="border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 md:flex-row md:items-start md:justify-between md:px-8">
          <div className="flex flex-col gap-2">
            <Brand />
            <p className="max-w-md text-caption text-muted-foreground">A free working concept for Canadian investors.</p>
          </div>
          <div className="flex flex-col gap-2 text-caption text-muted-foreground md:items-end">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group/link inline-flex w-fit items-center gap-1.5 rounded-sm transition-motion hover:text-foreground"
            >
              <GithubIcon aria-hidden className="size-3.5" />
              GitHub
              <ArrowUpRight aria-hidden className="size-3.5 transition-motion motion-safe:group-hover/link:translate-x-0.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <span>CRA rules · Canada only</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
