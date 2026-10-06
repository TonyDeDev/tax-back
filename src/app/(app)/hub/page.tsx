import type { Metadata } from "next";
import { Bell, Briefcase, PieChart, TableProperties } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Hub" };

export default async function Hub() {
  await requireUser("/hub");
  return (
    <>
      <PageHeader title="Hub" description="Every account in one place, with Canadian tax insight." />

      <section aria-label="Summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total value" value={<Money value={0} />} />
        <StatCard label="YTD realized gains" value={<Money value={0} signed />} />
        <StatCard label="Estimated tax" value={<Money value={0} />} hint="On capital gains only" />
        <StatCard label="Alerts" value="0" />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
          <CardDescription>Superficial losses, missing history, and broken connections.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState icon={Bell} title="Nothing needs attention" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>Grouped by brokerage.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Briefcase}
            title="No accounts yet"
            description="Connect a brokerage or explore the demo portfolio."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Investments</CardTitle>
          <CardDescription>Pooled by security, with a per-account view.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState icon={TableProperties} title="No investments to show" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allocation</CardTitle>
          <CardDescription>By security, account type, and currency.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState icon={PieChart} title="No allocation data yet" />
        </CardContent>
      </Card>
    </>
  );
}
