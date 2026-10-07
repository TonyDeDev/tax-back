import { Money } from "@/components/money";
import { AccountTypeSelect } from "@/components/sync/account-type-select";
import { Badge } from "@/components/ui/badge";
import { Tag } from "@/components/ui/tag";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HubAccount } from "@/server/queries/hub";

interface AccountRowProps {
  account: HubAccount;
  /** This account's share of the total on screen, 0 to 1, or null without a CAD value. */
  share: number | null;
  readOnly: boolean;
}

/** One account: name and masked number, its type, its share of the total, and its balance. */
export function AccountRow({ account: a, share, readOnly }: AccountRowProps) {
  const empty = a.valueCad !== null && Number(a.valueCad) === 0;
  const needsType = a.kind === "investment" && !a.confirmed;
  return (
    // Narrow: name and balance on one line, then the type and the share bar. Wider: one row of four columns.
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_15rem_7rem_8rem]">
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={cn("truncate text-body-sm font-medium", empty && "text-muted-foreground")}>{a.name}</span>
          {needsType && <Tag>Confirm type</Tag>}
        </div>
        {a.numberMasked && (
          <span className="font-mono text-caption text-muted-foreground">
            <span className="sr-only">Account ending in </span>
            <span aria-hidden>···· </span>
            {a.numberMasked}
          </span>
        )}
      </div>

      <span className={cn("text-right text-body-sm md:order-last", empty && "text-muted-foreground")}>
        {a.valueCad === null ? <span className="text-muted-foreground">No CAD rate</span> : <Money value={a.valueCad} className="font-mono" />}
      </span>

      <div className="col-span-2 md:col-span-1">
        {a.kind === "cash" ? (
          <Badge variant="outline" title="Holds cash only, so it never affects capital gains.">
            Cash account
          </Badge>
        ) : (
          <AccountTypeSelect accountId={a.id} accountName={a.name} value={a.accountType} confirmed={a.confirmed} readOnly={readOnly} />
        )}
      </div>

      <div className="col-span-2 flex items-center gap-2 md:col-span-1">
        <div aria-hidden className="h-1 flex-1 overflow-hidden rounded-sm bg-muted">
          <div className="h-full rounded-sm bg-chart-3" style={{ width: `${Math.min((share ?? 0) * 100, 100)}%` }} />
        </div>
        <span className="w-10 text-right font-mono text-caption tabular-nums text-muted-foreground">
          <span className="sr-only">Share of total: </span>
          {share === null ? "-" : formatPercent(share, 0)}
        </span>
      </div>
    </li>
  );
}
