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

/** The access token was rejected. The caller refreshes once and retries once. */
export class SnapTradeUnauthorizedError extends Error {
  constructor(readonly path: string) {
    super(`SnapTrade rejected the access token (${path})`);
    this.name = "SnapTradeUnauthorizedError";
  }
}

export class SnapTradeApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`SnapTrade returned ${status} for ${path}`);
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

/** `path` is for errors and logs: account ids are fine there, the token never is. */
async function get<T>(token: string, path: string, query: Query, schema: z.ZodType<T>): Promise<T> {
  const url = new URL(`${SNAPTRADE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
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

export function snaptradeClient(token: string): SnapTradeClient {
  const account = (id: string) => `/accounts/${encodeURIComponent(id)}`;
  return {
    listAuthorizations: () => get(token, "/authorizations", {}, z.array(authorizationSchema)),
    listAccounts: () => get(token, "/accounts", {}, z.array(accountSchema)),
    listPositions: async (id) => (await get(token, `${account(id)}/positions/all`, {}, positionsResponseSchema)).results,
    listBalances: (id) => get(token, `${account(id)}/balances`, {}, z.array(balanceSchema)),
    listAllActivities: async (id) => {
      const all: z.infer<typeof activitiesPageSchema>["data"] = [];
      for (let offset = 0; ; ) {
        const page = await get(
          token,
          `${account(id)}/activities`,
          { offset, limit: ACTIVITY_PAGE_SIZE },
          activitiesPageSchema,
        );
        all.push(...page.data);
        offset += page.data.length;
        if (page.data.length === 0 || offset >= page.pagination.total) return all;
      }
    },
  };
}
