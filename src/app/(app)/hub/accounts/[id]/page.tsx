import type { Metadata } from "next";
import { ChevronLeft, Wallet } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountDetail(props: PageProps<"/hub/accounts/[id]">) {
  const { id } = await props.params;
  await requireUser(`/hub/accounts/${id}`);
  return (
    <>
      <Link href="/hub" className="inline-flex items-center gap-1 text-body-sm text-link hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Hub
      </Link>
      <PageHeader title="Account" description={`Account ${id}`} />
      <Card>
        <CardHeader>
          <CardTitle>Holdings and activity</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Wallet}
            title="Account details coming soon"
            description="Balances, holdings, recent activity, and the account type confirmation will live here."
          />
        </CardContent>
      </Card>
    </>
  );
}
