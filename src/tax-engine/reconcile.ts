import { D, ZERO, type Dec } from "./decimal";
import { isRegistered } from "./registered";
import type { BrokerPosition, LedgerEntry, Reconciliation, ReconciliationRow, ReconciliationStatus } from "./types";

/** Brokers round fractional shares; anything closer than this is the same position. */
const TOLERANCE = new D("0.000001");

interface Tally {
  symbol: string;
  quantity: Dec;
}

function statusOf(ledger: Dec, broker: Dec): ReconciliationStatus {
  const gap = broker.minus(ledger);
  if (gap.abs().lte(TOLERANCE)) return "match";
  return gap.gt(0) ? "broker_has_more" : "ledger_has_more";
}

/**
 * Units of each security the ledger says every registered account holds. Registered accounts are
 * not pooled, so each is replayed on its own; a corporate action applies to every one of them.
 */
function registeredTallies(sorted: readonly LedgerEntry[]): Map<string, Map<string, Tally>> {
  const accounts = new Map<string, Map<string, Tally>>();
  const tallyOf = (accountId: string, securityId: string, symbol: string): Tally => {
    let account = accounts.get(accountId);
    if (!account) {
      account = new Map();
      accounts.set(accountId, account);
    }
    let tally = account.get(securityId);
    if (!tally) {
      tally = { symbol, quantity: ZERO };
      account.set(securityId, tally);
    }
    return tally;
  };

  for (const e of sorted) {
    if (e.kind === "spinoff" || e.kind === "merger") {
      if (!e.target) continue;
      for (const [accountId, account] of accounts) {
        const source = account.get(e.securityId);
        if (!source || !source.quantity.gt(0)) continue;
        const target = tallyOf(accountId, e.target.securityId, e.target.symbol);
        target.quantity = target.quantity.plus(source.quantity.times(e.splitRatio ?? 0));
        if (e.kind === "merger") source.quantity = ZERO;
      }
      continue;
    }
    if (!isRegistered(e.accountType)) continue;
    const tally = tallyOf(e.accountId, e.securityId, e.symbol);
    switch (e.kind) {
      case "buy":
      case "drip":
      case "stock_dividend":
      case "transfer_in":
        tally.quantity = tally.quantity.plus(e.quantity);
        break;
      case "sell":
      case "transfer_out":
        tally.quantity = tally.quantity.minus(e.quantity);
        break;
      // Each account reports a split for its own shares, so per account it applies every time.
      case "split":
        tally.quantity = tally.quantity.times(e.splitRatio ?? 1);
        break;
      default:
        break;
    }
  }
  return accounts;
}

/**
 * Compares the replayed ledger with what the brokers report holding today. The pooled non-registered
 * position is checked per security (that is the number ACB depends on), and each registered account on
 * its own. A gap means history is missing or an event was not understood, so the user is asked to fill it.
 */
export function reconcile(
  sorted: readonly LedgerEntry[],
  poolQuantities: ReadonlyMap<string, { symbol: string; quantity: Dec }>,
  broker: readonly BrokerPosition[],
): Reconciliation {
  const rows: ReconciliationRow[] = [];
  const push = (securityId: string, symbol: string, accountId: string | null, ledger: Dec, held: Dec) => {
    if (ledger.isZero() && held.isZero()) return;
    rows.push({ securityId, symbol, accountId, ledgerQuantity: ledger, brokerQuantity: held, status: statusOf(ledger, held) });
  };

  const pooledBroker = new Map<string, Tally>();
  const registeredBroker = new Map<string, Map<string, Tally>>();
  for (const p of broker) {
    if (isRegistered(p.accountType)) {
      const account = registeredBroker.get(p.accountId) ?? new Map<string, Tally>();
      const tally = account.get(p.securityId) ?? { symbol: p.symbol, quantity: ZERO };
      tally.quantity = tally.quantity.plus(p.quantity);
      account.set(p.securityId, tally);
      registeredBroker.set(p.accountId, account);
    } else {
      const tally = pooledBroker.get(p.securityId) ?? { symbol: p.symbol, quantity: ZERO };
      tally.quantity = tally.quantity.plus(p.quantity);
      pooledBroker.set(p.securityId, tally);
    }
  }

  for (const securityId of new Set([...poolQuantities.keys(), ...pooledBroker.keys()])) {
    const ledger = poolQuantities.get(securityId);
    const held = pooledBroker.get(securityId);
    push(securityId, ledger?.symbol ?? held?.symbol ?? securityId, null, ledger?.quantity ?? ZERO, held?.quantity ?? ZERO);
  }

  const ledgerAccounts = registeredTallies(sorted);
  for (const accountId of new Set([...ledgerAccounts.keys(), ...registeredBroker.keys()])) {
    const ledger = ledgerAccounts.get(accountId) ?? new Map<string, Tally>();
    const held = registeredBroker.get(accountId) ?? new Map<string, Tally>();
    for (const securityId of new Set([...ledger.keys(), ...held.keys()])) {
      const l = ledger.get(securityId);
      const h = held.get(securityId);
      push(securityId, l?.symbol ?? h?.symbol ?? securityId, accountId, l?.quantity ?? ZERO, h?.quantity ?? ZERO);
    }
  }

  rows.sort(
    (a, b) =>
      Number(a.status === "match") - Number(b.status === "match") ||
      (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0) ||
      Number(a.accountId !== null) - Number(b.accountId !== null),
  );
  return { rows, matched: rows.filter((r) => r.status === "match").length, total: rows.length };
}
