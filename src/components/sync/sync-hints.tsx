import { InfoHint } from "@/components/ui/info-hint";

/*
 * What a user should know about SnapTrade's timing, said once and reused wherever sync state shows.
 * SnapTrade reads each brokerage on its own schedule, so TaxBack can only show what SnapTrade has.
 */

/** Beside a "Synced" status: the data is as fresh as SnapTrade's last read of the brokerage. */
export function SyncTimingHint({ align = "center" }: { align?: "start" | "center" | "end" }) {
  return (
    <InfoHint label="About sync timing" tone="warning" align={align}>
      TaxBack shows what SnapTrade last read from your brokerage. SnapTrade refreshes most brokerages about once a
      day, so a trade, dividend, or deposit can take up to a day to appear here, even after you press Refresh.
    </InfoHint>
  );
}

/** Beside a brokerage that was just connected and has nothing yet. */
export function NewConnectionHint({ align = "center" }: { align?: "start" | "center" | "end" }) {
  return (
    <InfoHint label="Why accounts are missing" tone="warning" align={align}>
      A brokerage you just connected can take from a few minutes to a day before SnapTrade has its accounts,
      holdings, and history. Some brokerages also share only recent history. TaxBack picks up what arrives on the
      next refresh or the daily sync.
    </InfoHint>
  );
}
