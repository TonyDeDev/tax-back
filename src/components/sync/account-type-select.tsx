"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { confirmAccountType } from "@/app/(app)/hub/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_OPTIONS } from "@/lib/account-types";
import type { AccountType } from "@/tax-engine/types";

interface AccountTypeSelectProps {
  accountId: string;
  accountName: string;
  value: AccountType;
  confirmed: boolean;
  /** The demo is read-only, so it shows the type without the picker. */
  readOnly?: boolean;
}

/** The account type decides whether sales are taxable, so the user confirms TaxBack's guess. */
export function AccountTypeSelect({ accountId, accountName, value, confirmed, readOnly = false }: AccountTypeSelectProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string>(value);

  if (readOnly) return <Badge variant="outline">{ACCOUNT_TYPE_LABELS[value]}</Badge>;

  const change = (next: string) =>
    startTransition(async () => {
      setError(null);
      const result = await confirmAccountType(accountId, next);
      if (!result.ok) setError(result.message);
    });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <select
          aria-label={`Account type for ${accountName}`}
          value={current}
          disabled={pending}
          onChange={(event) => {
            setCurrent(event.target.value);
            change(event.target.value);
          }}
          className="h-8 rounded-md border border-border bg-background px-2 text-body-sm text-foreground disabled:opacity-50"
        >
          {ACCOUNT_TYPE_OPTIONS.map(([type, label]) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
        {pending ? (
          <Loader2 aria-label="Saving" className="size-4 animate-spin text-muted-foreground" />
        ) : confirmed ? null : (
          // Picking a different type confirms it; this confirms a guess that is already right.
          <Button variant="outline" size="sm" onClick={() => change(current)} title="TaxBack guessed this type from the broker.">
            Confirm
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-caption text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
