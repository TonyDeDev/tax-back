import type { Metadata } from "next";
import { ChevronLeft, Layers } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityDetail(props: PageProps<"/hub/securities/[id]">) {
  const { id } = await props.params;
  return (
    <>
      <Link href="/hub" className="inline-flex items-center gap-1 text-body-sm text-link hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Hub
      </Link>
      <PageHeader title="Security" description={`Security ${id}`} />
      <Card>
        <CardHeader>
          <CardTitle>ACB breakdown</CardTitle>
          <CardDescription>Pooled across all non-registered accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Layers}
            title="ACB history coming soon"
            description="Each buy, sell, return of capital, and superficial loss adjustment will be listed here."
          />
        </CardContent>
      </Card>
    </>
  );
}
