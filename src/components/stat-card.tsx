import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
}

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="font-display text-heading-sm font-medium tabular-nums">{value}</p>
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}
