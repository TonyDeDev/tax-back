import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-4 py-10 text-center">
      <Icon aria-hidden className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-body font-medium">{title}</p>
        {description ? <p className="max-w-md text-body-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
