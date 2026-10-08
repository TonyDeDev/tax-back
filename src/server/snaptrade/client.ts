import "server-only";
import { z } from "zod";
import {
  accountSchema,
  activitiesPageSchema,
  authorizationSchema,
  balanceSchema,
  positionsResponseSchema,
} from "./schemas";

/*
 * SnapTrade read API over the OAuth access token. OAuth calls carry only `Authorization: Bearer`;
 * the Commercial fields (clientId, consumerKey, userId, userSecret, timestamp, Signature) are never sent.
 * Paths were confirmed against live responses: `/positions` and `/holdings` answer 410 for OAuth apps,
 * `/positions/all` replaces them.
 */

export const SNAPTRADE_API_BASE = "https://api.snaptrade.com/api/v1";
/** SnapTrade's maximum page size for activities. */
export const ACTIVITY_PAGE_SIZE = 1000;
/** 200,000 activities in one account is far past any real history; more means the paging is not ending. */
const MAX_ACTIVITY_PAGES = 200;
/** One request may not hold a sync hostage: Vercel stops the whole function at 300 seconds. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Waits before each retry of a rate-limited (429), failed (5xx) or unreachable request. */
export const RETRY_DELAYS_MS = [1_000, 3_000] as const;
/** The longest `Retry-After` honoured; longer means try again on the next sync instead. */
const MAX_RETRY_AFTER_MS = 10_000;

/** The access token was rejected. The caller refreshes once and retries once. */
export class SnapTradeUnauthorizedError extends Error {
  constructor(readonly path: string) {
    super(`SnapTrade rejected the access token (${path})`);
    this.name = "SnapTradeUnauthorizedError";
  }
}

/** `status` 0 means no response at all: a timeout or a network failure. */
export class SnapTradeApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    options?: ErrorOptions,
  ) {
    super(status === 0 ? `SnapTrade did not respond for ${path}` : `SnapTrade returned ${status} for ${path}`, options);
    this.name = "SnapTradeApiError";
  }
}

export class SnapTradeResponseError extends Error {
  constructor(path: string, issues: string) {
    super(`SnapTrade sent an unexpected response for ${path}: ${issues}`);
    this.name = "SnapTradeResponseError";
  }
}

type Query = Record<string, string | number | undefined>;

interface ClientOptions {
  /** Waits before each retry; tests pass zeros. */
  retryDelaysMs?: readonly number[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `Retry-After` as seconds or an HTTP date, in ms, or null when absent or unreadable. */
function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

const retryable = (status: number) => status === 429 || status >= 500;

/**
 * One GET, retried after a short wait when SnapTrade rate-limits, fails on its side, times out, or is
 * unreachable. A 401 or another 4xx is never retried: the caller decides what those mean.
 * `path` is for errors and logs: account ids are fine there, the token never is.
 */
async function get<T>(token: string, path: string, query: Query, schema: z.ZodType<T>, options: ClientOptions = {}): Promise<T> {
  const url = new URL(`${SNAPTRADE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;

  let res: Response;
  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < delays.length;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // A timeout or a network failure.
      if (!canRetry) throw new SnapTradeApiError(0, path, { cause: error });
      await sleep(delays[attempt]!);
      continue;
    }
    if (!retryable(res.status) || !canRetry) break;
    const wait = retryAfterMs(res.headers.get("retry-after"));
    if (wait !== null && wait > MAX_RETRY_AFTER_MS) break;
    // Drain the body so the connection can be reused.
    await res.body?.cancel();
    await sleep(Math.max(delays[attempt]!, wait ?? 0));
  }

  if (res.status === 401) throw new SnapTradeUnauthorizedError(path);
  if (!res.ok) throw new SnapTradeApiError(res.status, path);

  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new SnapTradeResponseError(path, z.prettifyError(parsed.error));
  return parsed.data;
}

export interface SnapTradeClient {
  listAuthorizations(): Promise<z.infer<typeof authorizationSchema>[]>;
  listAccounts(): Promise<z.infer<typeof accountSchema>[]>;
  listPositions(accountId: string): Promise<z.infer<typeof positionsResponseSchema>["results"]>;
  listBalances(accountId: string): Promise<z.infer<typeof balanceSchema>[]>;
  /** Every activity, newest pages included; SnapTrade caps a page at 1000, so this follows `pagination.total`. */
  listAllActivities(accountId: string): Promise<z.infer<typeof activitiesPageSchema>["data"]>;
}

export function snaptradeClient(token: string, options: ClientOptions = {}): SnapTradeClient {
  const account = (id: string) => `/accounts/${encodeURIComponent(id)}`;
  return {
    listAuthorizations: () => get(token, "/authorizations", {}, z.array(authorizationSchema), options),
    listAccounts: () => get(token, "/accounts", {}, z.array(accountSchema), options),
    listPositions: async (id) =>
      (await get(token, `${account(id)}/positions/all`, {}, positionsResponseSchema, options)).results,
    listBalances: (id) => get(token, `${account(id)}/balances`, {}, z.array(balanceSchema), options),
    listAllActivities: async (id) => {
      const path = `${account(id)}/activities`;
      const all: z.infer<typeof activitiesPageSchema>["data"] = [];
      for (let offset = 0, pages = 0; ; pages++) {
        // Stopping short would drop history and make the ACB wrong, so this fails the sync instead.
        if (pages >= MAX_ACTIVITY_PAGES) throw new SnapTradeResponseError(path, "activity paging did not end");
        const page = await get(token, path, { offset, limit: ACTIVITY_PAGE_SIZE }, activitiesPageSchema, options);
        all.push(...page.data);
        offset += page.data.length;
        if (page.data.length === 0 || offset >= page.pagination.total) return all;
      }
    },
  };
}
