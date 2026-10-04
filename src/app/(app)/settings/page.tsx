import type { Metadata } from "next";
import { Link2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Settings" };

export default function Settings() {
  return (
    <>
      <PageHeader title="Settings" />

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Follows your system theme until you pick one.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="text-body-sm">Theme</span>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected brokerages</CardTitle>
          <CardDescription>The free SnapTrade plan allows 5 connected accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Link2}
            title="No brokerages connected"
            action={
              <Button size="sm" disabled>
                Connect a brokerage
              </Button>
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete my data</CardTitle>
          <CardDescription>Removes your connections, transactions, and tax results for good.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" size="sm" disabled>
            Delete my data
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
