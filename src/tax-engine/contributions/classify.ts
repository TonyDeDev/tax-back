import { rrspScheduleYear } from "../config/contribution-limits";
import { addDays, yearOf } from "../dates";
import type { AccountType, FxLookup, LedgerEntry } from "../types";
import type { CashFlow, ClassifiedFlow, FlowKind, Plan } from "./types";

/** Cash moved between two of the user's own accounts at one broker. */
const INTERNAL_TRANSFER = /^INTERNAL_CASH_TRANSFER_(IN|OUT)$/;
/** Both sides of an internal transfer usually post the same day; brokers sometimes take a few days. */
const PAIR_WINDOW_DAYS = 3;

const isPlan = (type: AccountType): type is Plan => type !== "non_registered";

/** The plan a flow touches, or null when it is outside any registered plan (non-registered or a cash account). */
function planOf(flow: CashFlow): Plan | null {
  return flow.investment && isPlan(flow.plan) ? flow.plan : null;
}

/**
 * Pairs each internal cash transfer with its other side: the same amount and currency, the opposite
 * direction, another account, within a few days. The closest date wins. Returns flow id -> other side.
 */
function pairInternalTransfers(flows: readonly CashFlow[]): Map<string, CashFlow> {
  const internal = flows.filter((f) => f.brokerType !== null && INTERNAL_TRANSFER.test(f.brokerType));
  const outs = internal.filter((f) => f.direction === "out");
  const pairs = new Map<string, CashFlow>();
  const candidates = internal
    .filter((f) => f.direction === "in")
    .flatMap((inFlow) =>
      outs
        .filter(
          (o) =>
            o.accountId !== inFlow.accountId &&
            o.currency === inFlow.currency &&
            o.amount.equals(inFlow.amount) &&
            o.date >= addDays(inFlow.date, -PAIR_WINDOW_DAYS) &&
            o.date <= addDays(inFlow.date, PAIR_WINDOW_DAYS),
        )
        .map((o) => ({ inFlow, out: o, gap: Math.abs(Date.parse(o.date) - Date.parse(inFlow.date)) })),
    )
    // Closest first; ids break ties so the result never depends on input order.
    .sort((a, b) => a.gap - b.gap || a.inFlow.id.localeCompare(b.inFlow.id) || a.out.id.localeCompare(b.out.id));
  for (const { inFlow, out } of candidates) {
    if (pairs.has(inFlow.id) || pairs.has(out.id)) continue;
    pairs.set(inFlow.id, out);
    pairs.set(out.id, inFlow);
  }
  return pairs;
}

function byDirection(flow: CashFlow): FlowKind {
  return flow.direction === "in" ? "contribution" : "withdrawal";
}

/**
 * A transfer whose other side TaxBack sees, in `otherPlan` (null outside any registered plan). Within one
 * plan type it is a transfer; from a non-registered account an ordinary contribution or withdrawal;
 * between two different plans the broker may have done a direct transfer the user should confirm.
 */
function readAgainst(flow: CashFlow, plan: Plan, otherPlan: Plan | null): { kind: FlowKind; needsReview: boolean } {
  if (otherPlan === plan) return { kind: "transfer", needsReview: false };
  if (plan === "fhsa" && otherPlan === "rrsp" && flow.direction === "in") return { kind: "rrsp_to_fhsa", needsReview: false };
  if (plan === "rrsp" && otherPlan === "fhsa" && flow.direction === "out") return { kind: "transfer", needsReview: false };
  return { kind: byDirection(flow), needsReview: otherPlan !== null };
}

/**
 * `other` is the paired side of an internal cash transfer. `partner` is set only for shares moved in
 * kind: the ledger entry on the other side, or null when TaxBack cannot see it.
 */
function readKind(
  flow: CashFlow,
  plan: Plan,
  other: CashFlow | undefined,
  partner: LedgerEntry | null | undefined,
): { kind: FlowKind; needsReview: boolean } {
  switch (flow.classification) {
    case "contribution":
    case "withdrawal":
    case "transfer":
      return { kind: flow.classification, needsReview: false };
    case "ignore":
      return { kind: "ignored", needsReview: false };
    case "rrsp_to_fhsa":
      // Counted on the FHSA side; on the RRSP side it is neither a contribution nor a withdrawal.
      if (plan === "fhsa" && flow.direction === "in") return { kind: "rrsp_to_fhsa", needsReview: false };
      if (plan === "rrsp" && flow.direction === "out") return { kind: "transfer", needsReview: false };
      return { kind: "ignored", needsReview: true };
    case null:
      break;
  }

  // Shares moved in kind: the ledger paired the two sides, and the other side's account says what it was.
  if (partner !== undefined) {
    if (partner === null) return { kind: byDirection(flow), needsReview: true };
    return readAgainst(flow, plan, isPlan(partner.accountType) ? partner.accountType : null);
  }
  const type = flow.brokerType;
  if (type !== null && INTERNAL_TRANSFER.test(type)) {
    if (!other) return { kind: byDirection(flow), needsReview: true };
    return readAgainst(flow, plan, planOf(other));
  }
  // A reversed deposit or a returned withdrawal: the reading by direction is a guess.
  const expected = type === "WITHDRAWAL" ? "out" : type === "CONTRIBUTION" || type === "DEPOSIT" ? "in" : flow.direction;
  return { kind: byDirection(flow), needsReview: expected !== flow.direction };
}

/** Reads every flow as a contribution, withdrawal, or transfer, converted to CAD at the Bank of Canada rate for its date. */
export function classifyFlows(
  flows: readonly CashFlow[],
  fx: FxLookup,
  transfers: ReadonlyMap<string, LedgerEntry> = new Map(),
): ClassifiedFlow[] {
  const pairs = pairInternalTransfers(flows);
  return flows.map((flow) => {
    const plan = planOf(flow);
    const rate = fx(flow.currency, flow.date);
    const base = {
      flowId: flow.id,
      amountCad: flow.amount.times(rate),
      fxRate: flow.currency === "CAD" ? null : rate,
    };
    if (plan === null) return { ...base, plan, kind: "ignored", taxYear: yearOf(flow.date), needsReview: false };
    const partner = flow.transferEntryId ? (transfers.get(flow.transferEntryId) ?? null) : undefined;
    const { kind, needsReview } = readKind(flow, plan, pairs.get(flow.id), partner);
    const taxYear = plan === "rrsp" && kind === "contribution" ? rrspScheduleYear(flow.date) : yearOf(flow.date);
    return { ...base, plan, kind, taxYear, needsReview };
  });
}
