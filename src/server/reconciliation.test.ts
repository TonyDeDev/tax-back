import { describe, expect, it } from "vitest";
import { carryGapSince, gapClass, isWaiting, type StoredReconciliation } from "./reconciliation";

const TODAY = "2026-10-07";
const pooled = (securityId: string, status: StoredReconciliation["status"], gapSince: string | null = null): StoredReconciliation => ({
  securityId,
  accountId: null,
  status,
  gapSince,
});

describe("carryGapSince", () => {
  it("gives null on the first reconciliation: history the broker never shared is a real gap at once", () => {
    const [row] = carryGapSince([{ securityId: "VFV", accountId: null, status: "broker_has_more" as const }], [], TODAY);
    expect(row!.gapSince).toBeNull();
  });

  it("starts today when a matching position drifts, like a recurring buy not reported yet", () => {
    const [row] = carryGapSince([{ securityId: "VFV", accountId: null, status: "broker_has_more" as const }], [pooled("VFV", "match")], TODAY);
    expect(row!.gapSince).toBe(TODAY);
  });

  it("keeps the first day while the gap lasts in the same direction", () => {
    const [row] = carryGapSince(
      [{ securityId: "VFV", accountId: null, status: "broker_has_more" as const }],
      [pooled("VFV", "broker_has_more", "2026-10-01")],
      TODAY,
    );
    expect(row!.gapSince).toBe("2026-10-01");
  });

  it("keeps null for a gap that has been there since the first sync", () => {
    const [row] = carryGapSince([{ securityId: "VFV", accountId: null, status: "broker_has_more" as const }], [pooled("VFV", "broker_has_more")], TODAY);
    expect(row!.gapSince).toBeNull();
  });

  it("restarts when the direction flips, and clears on a match", () => {
    const [flipped, matched] = carryGapSince(
      [
        { securityId: "VFV", accountId: null, status: "ledger_has_more" as const },
        { securityId: "XEQT", accountId: null, status: "match" as const },
      ],
      [pooled("VFV", "broker_has_more", "2026-09-01"), pooled("XEQT", "broker_has_more", "2026-10-06")],
      TODAY,
    );
    expect(flipped!.gapSince).toBe(TODAY);
    expect(matched!.gapSince).toBeNull();
  });

  it("starts today for a new position in an account already reconciled, null in a new account", () => {
    const [newSecurity, newAccount] = carryGapSince(
      [
        { securityId: "BNS", accountId: "tfsa", status: "broker_has_more" as const },
        { securityId: "BNS", accountId: "rrsp", status: "broker_has_more" as const },
      ],
      [{ securityId: "VFV", accountId: "tfsa", status: "match", gapSince: null }],
      TODAY,
    );
    expect(newSecurity!.gapSince).toBe(TODAY);
    expect(newAccount!.gapSince).toBeNull();
  });

  it("treats pooled rows as one account and an absent accountId as pooled", () => {
    const [row] = carryGapSince([{ securityId: "NEW", status: "broker_has_more" as const }], [pooled("VFV", "match")], TODAY);
    expect(row!.gapSince).toBe(TODAY);
  });
});

describe("gapClass", () => {
  it("registered rows never change tax", () => {
    expect(gapClass({ accountId: "tfsa", gapSince: TODAY }, TODAY)).toBe("registered");
  });

  it("a non-registered gap waits 3 days, then asks", () => {
    expect(gapClass({ accountId: null, gapSince: "2026-10-05" }, TODAY)).toBe("waiting");
    expect(gapClass({ accountId: null, gapSince: "2026-10-04" }, TODAY)).toBe("tax");
    expect(gapClass({ accountId: null, gapSince: null }, TODAY)).toBe("tax");
  });

  it("isWaiting is false without a start day", () => {
    expect(isWaiting(null, TODAY)).toBe(false);
    expect(isWaiting(TODAY, TODAY)).toBe(true);
  });
});
