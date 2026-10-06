"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown, TableProperties } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { formatMoney, formatPercent, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

export interface PooledHolding {
  securityId: string;
  symbol: string;
  name: string | null;
  brokerQuantity: string;
  marketValueCad: string | null;
  pooledQuantity: string;
  totalAcbCad: string | null;
  unrealizedCad: string | null;
  trend: string[];
  /** Share of the total value on screen, 0 to 1, or null without a market value. */
  weight: string | null;
}

export interface AccountHolding {
  securityId: string;
  symbol: string;
  name: string | null;
  accountId: string;
  accountName: string;
  brokerageName: string;
  accountTypeLabel: string;
  quantity: string;
  marketValueCad: string | null;
  weight: string | null;
}

type View = "pooled" | "account";
type PooledKey = "symbol" | "brokerQuantity" | "marketValueCad" | "pooledQuantity" | "totalAcbCad" | "unrealizedCad";
type AccountKey = "symbol" | "accountName" | "accountTypeLabel" | "quantity" | "marketValueCad";
interface Sort<K> {
  key: K;
  desc: boolean;
}

const auditHref = (securityId: string) => `/hub/securities/${securityId}#audit`;

/** Text sorts alphabetically; numbers numerically with missing values last either way. */
function compare(a: string | null, b: string | null, numeric: boolean, desc: boolean): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const order = numeric ? Number(a) - Number(b) : a.localeCompare(b);
  return desc ? -order : order;
}

function sortRows<T, K extends keyof T & string>(rows: T[], sort: Sort<K>, textKeys: readonly K[]): T[] {
  const numeric = !textKeys.includes(sort.key);
  return [...rows].sort((x, y) => compare(x[sort.key] as string | null, y[sort.key] as string | null, numeric, sort.desc));
}

function SortHeader<K extends string>({
  label,
  column,
  sort,
  onSort,
  align = "right",
  className,
}: {
  label: string;
  column: K;
  sort: Sort<K>;
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === column;
  const Icon = !active ? ChevronsUpDown : sort.desc ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : undefined}
      className={cn("sticky top-8 z-[1] border-b bg-card px-2 py-2 xl:px-3 font-medium", align === "right" ? "text-right" : "text-left", className)}
    >
      {/* Inline, so a label that wraps keeps its sort icon right after the last word. */}
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn("rounded-sm font-medium hover:text-foreground", align === "right" ? "text-right" : "text-left", active && "text-foreground")}
      >
        {label.slice(0, label.lastIndexOf(" ") + 1)}
        <span className="whitespace-nowrap">
          {label.slice(label.lastIndexOf(" ") + 1)}
          <Icon aria-hidden className={cn("ml-1 inline size-3.5 align-[-2px]", !active && "opacity-60")} />
        </span>
      </button>
    </th>
  );
}

function PlainHeader({ label, className }: { label: string; className?: string }) {
  return (
    <th scope="col" className={cn("sticky top-8 z-[1] border-b bg-card px-2 py-2 xl:px-3 text-right font-medium", className)}>
      {label}
    </th>
  );
}

function WeightBar({ weight }: { weight: string | null }) {
  if (weight === null) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden className="h-1 w-12 overflow-hidden rounded-sm bg-muted">
        <span className="block h-full rounded-sm bg-chart-3" style={{ width: `${Math.min(Number(weight) * 100, 100)}%` }} />
      </span>
      <span className="w-12 text-right">{formatPercent(weight, 1)}</span>
    </span>
  );
}

function SecurityCell({ symbol, name, securityId }: { symbol: string; name: string | null; securityId: string }) {
  return (
    <>
      <Link
        href={auditHref(securityId)}
        onClick={(event) => event.stopPropagation()}
        className="font-mono font-medium text-link hover:underline"
      >
        {symbol}
        <span className="sr-only">, open the ACB audit trail</span>
      </Link>
      {name && <span className="block max-w-[16rem] truncate text-caption text-muted-foreground">{name}</span>}
    </>
  );
}

const rowClass = "cursor-pointer border-b transition-colors last:border-0 hover:bg-muted";
const cell = "px-2 py-2.5 xl:px-3 text-right font-mono";

function PooledTable({ rows }: { rows: PooledHolding[] }) {
  const router = useRouter();
  const [sort, setSort] = useState<Sort<PooledKey>>({ key: "marketValueCad", desc: true });
  const onSort = (key: PooledKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "symbol" }));
  const sorted = sortRows(rows, sort, ["symbol"]);
  return (
    <table className="hidden w-full text-body-sm tabular-nums md:table">
      <thead className="text-caption text-muted-foreground">
        <tr>
          <SortHeader label="Security" column="symbol" sort={sort} onSort={onSort} align="left" />
          <PlainHeader label="90 days" className="hidden xl:table-cell" />
          <SortHeader label="Units, all accounts" column="brokerQuantity" sort={sort} onSort={onSort} />
          <SortHeader label="Market value" column="marketValueCad" sort={sort} onSort={onSort} />
          <PlainHeader label="Weight" className="hidden min-[1400px]:table-cell" />
          <SortHeader label="Non-registered units" column="pooledQuantity" sort={sort} onSort={onSort} />
          <SortHeader label="Pooled ACB" column="totalAcbCad" sort={sort} onSort={onSort} />
          <SortHeader label="Unrealized" column="unrealizedCad" sort={sort} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.securityId} className={rowClass} onClick={() => router.push(auditHref(r.securityId))}>
            <td className="px-2 py-2.5 xl:px-3">
              <SecurityCell symbol={r.symbol} name={r.name} securityId={r.securityId} />
            </td>
            <td className="hidden px-2 py-2.5 xl:px-3 text-right xl:table-cell">
              <span className="inline-flex justify-end">
                <Sparkline
                  values={r.trend}
                  label={
                    r.trend.length > 1
                      ? `${r.symbol} price over 90 days: ${formatMoney(r.trend[0]!)} to ${formatMoney(r.trend.at(-1)!)}`
                      : `${r.symbol}: no price history yet`
                  }
                />
              </span>
            </td>
            <td className={cell}>{formatQuantity(r.brokerQuantity)}</td>
            <td className={cell}>{r.marketValueCad ? formatMoney(r.marketValueCad) : "-"}</td>
            <td className={cn(cell, "hidden text-muted-foreground min-[1400px]:table-cell")}>
              <WeightBar weight={r.weight} />
            </td>
            <td className={cell}>{formatQuantity(r.pooledQuantity)}</td>
            <td className={cell}>{r.totalAcbCad ? formatMoney(r.totalAcbCad) : "-"}</td>
            <td className={cell}>{r.unrealizedCad ? <Money value={r.unrealizedCad} signed className="justify-end" /> : "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AccountTable({ rows }: { rows: AccountHolding[] }) {
  const router = useRouter();
  const [sort, setSort] = useState<Sort<AccountKey>>({ key: "marketValueCad", desc: true });
  const onSort = (key: AccountKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key === "quantity" || key === "marketValueCad" }));
  const sorted = sortRows(rows, sort, ["symbol", "accountName", "accountTypeLabel"]);
  return (
    <table className="hidden w-full text-body-sm tabular-nums md:table">
      <thead className="text-caption text-muted-foreground">
        <tr>
          <SortHeader label="Security" column="symbol" sort={sort} onSort={onSort} align="left" />
          <SortHeader label="Account" column="accountName" sort={sort} onSort={onSort} align="left" />
          <SortHeader label="Type" column="accountTypeLabel" sort={sort} onSort={onSort} align="left" className="hidden lg:table-cell" />
          <SortHeader label="Units" column="quantity" sort={sort} onSort={onSort} />
          <SortHeader label="Market value" column="marketValueCad" sort={sort} onSort={onSort} />
          <PlainHeader label="Weight" className="hidden xl:table-cell" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={`${r.accountId}|${r.securityId}|${r.symbol}`} className={rowClass} onClick={() => router.push(auditHref(r.securityId))}>
            <td className="px-2 py-2.5 xl:px-3">
              <SecurityCell symbol={r.symbol} name={r.name} securityId={r.securityId} />
            </td>
            <td className="px-2 py-2.5 xl:px-3">
              <span className="block">{r.accountName}</span>
              <span className="block text-caption text-muted-foreground">{r.brokerageName}</span>
            </td>
            <td className="hidden px-2 py-2.5 xl:px-3 text-muted-foreground lg:table-cell">{r.accountTypeLabel}</td>
            <td className={cell}>{formatQuantity(r.quantity)}</td>
            <td className={cell}>{r.marketValueCad ? formatMoney(r.marketValueCad) : "-"}</td>
            <td className={cn(cell, "hidden text-muted-foreground xl:table-cell")}>
              <WeightBar weight={r.weight} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Narrow screens: one stacked row per holding, market value on the right. */
function StackedList({ rows }: { rows: (PooledHolding | AccountHolding)[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border md:hidden">
      {rows.map((r) => {
        const units = "quantity" in r ? r.quantity : r.brokerQuantity;
        return (
          <li key={"accountId" in r ? `${r.accountId}|${r.securityId}|${r.symbol}` : r.securityId}>
            <Link href={auditHref(r.securityId)} className="flex items-start justify-between gap-4 py-3 hover:bg-muted">
              <span className="flex min-w-0 flex-col">
                <span className="font-mono text-body-sm font-medium text-link">{r.symbol}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {"accountName" in r ? `${r.accountName} · ${r.brokerageName}` : (r.name ?? "")}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end font-mono tabular-nums">
                <span className="text-body-sm">{r.marketValueCad ? formatMoney(r.marketValueCad) : "-"}</span>
                <span className="text-caption text-muted-foreground">{formatQuantity(units)} units</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

interface HoldingsTableProps {
  pooled: PooledHolding[];
  byAccount: AccountHolding[];
  /** Shown beside the view toggle, such as the ledger vs broker match rate. */
  aside?: ReactNode;
}

/** Investments: pooled by security (the ACB view) or one row per account. Select a row for its ACB audit trail. */
export function HoldingsTable({ pooled, byAccount, aside }: HoldingsTableProps) {
  const [view, setView] = useState<View>("pooled");
  const rows = view === "pooled" ? pooled : byAccount;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="group" aria-label="Group investments" className="flex w-fit rounded-md border p-0.5">
          {(
            [
              ["pooled", "Pooled"],
              ["account", "By account"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cn(
                "h-7 rounded-sm px-3 text-caption font-medium whitespace-nowrap transition-colors",
                view === value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {aside}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={TableProperties} title="No investments to show" />
      ) : (
        <>
          {view === "pooled" ? <PooledTable rows={pooled} /> : <AccountTable rows={byAccount} />}
          <StackedList rows={rows} />
        </>
      )}
    </div>
  );
}
