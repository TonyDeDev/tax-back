import type { Metadata } from "next";
import { Download, FileText, Lightbulb, Percent, TrendingDown } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tax Center" };

const YEARS = [2026, 2025, 2024];

export default async function TaxCenter(props: PageProps<"/tax/[year]">) {
  const { year: raw } = await props.params;
  const year = Number(raw);
  if (!YEARS.includes(year)) notFound();

  return (
    <>
      <PageHeader
        title={`Tax Center ${year}`}
        description="Schedule 3 style summary of your realized gains, losses, and income."
        actions={
          <Button variant="outline" size="sm" disabled>
            <Download aria-hidden className="size-4" />
            Export CSV
          </Button>
        }
      />

      <nav aria-label="Tax year" className="flex gap-1">
        {YEARS.map((y) => (
          <Link
            key={y}
            href={`/tax/${y}`}
            aria-current={y === year ? "page" : undefined}
            className={cn(
              "rounded-sm px-3 py-1.5 text-body-sm font-medium tabular-nums transition-colors",
              y === year ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {y}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>Realized gains</CardTitle>
          <CardDescription>Proceeds, ACB, outlays, and gain by security.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState icon={FileText} title="No realized gains for this year" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Superficial losses</CardTitle>
          <CardDescription>Denied losses and where they moved.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState icon={TrendingDown} title="No superficial losses" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dividends</CardTitle>
          <CardDescription>Eligible, non-eligible, and foreign.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState icon={Percent} title="No dividend income" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax-loss harvesting</CardTitle>
          <CardDescription>Positions with unrealized losses and their 30-day windows.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState icon={Lightbulb} title="No harvesting opportunities" />
        </CardContent>
      </Card>
    </>
  );
}
