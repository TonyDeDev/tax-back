import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SnapTradeApiError,
  SnapTradeResponseError,
  SnapTradeUnauthorizedError,
  snaptradeClient,
} from "./client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("snaptradeClient", () => {
  it("sends only the Bearer token, never Commercial auth fields", async () => {
    const fetchMock = vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>(async () => json([]));
    vi.stubGlobal("fetch", fetchMock);
    await snaptradeClient("token-1").listAccounts();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.snaptrade.com/api/v1/accounts");
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer token-1");
    for (const field of ["clientId", "consumerKey", "userId", "userSecret", "timestamp", "Signature"]) {
      expect(String(url)).not.toContain(field);
      expect(new Headers(init!.headers).has(field)).toBe(false);
    }
  });

  it("reads holdings from /positions/all", async () => {
    const fetchMock = vi.fn(async () => json({ results: [], data_freshness: { as_of: "2026-10-06T03:01:06Z" } }));
    vi.stubGlobal("fetch", fetchMock);
    await snaptradeClient("t").listPositions("acc/1");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      "https://api.snaptrade.com/api/v1/accounts/acc%2F1/positions/all",
    );
  });

  it("follows activity pages until the total is reached", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ id: `a${i}`, type: "BUY" }));
    const fetchMock = vi.fn(async (url: URL) => {
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      return json({ data: all.slice(offset, offset + limit), pagination: { offset, limit, total: all.length } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await snaptradeClient("t").listAllActivities("acc-1");
    expect(result).toHaveLength(2500);
    expect(new Set(result.map((a) => a.id)).size).toBe(2500);
    expect(fetchMock.mock.calls.map(([u]) => u.searchParams.get("offset"))).toEqual(["0", "1000", "2000"]);
    expect(fetchMock.mock.calls.every(([u]) => u.searchParams.get("limit") === "1000")).toBe(true);
  });

  it("stops on an empty page even if the total claims more", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [], pagination: { offset: 0, limit: 1000, total: 5 } })));
    expect(await snaptradeClient("t").listAllActivities("acc-1")).toEqual([]);
  });

  it("keeps fields it does not declare on activities, for the raw copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ data: [{ id: "a1", type: "BUY", institution: "X" }], pagination: { offset: 0, limit: 1000, total: 1 } }),
      ),
    );
    const [first] = await snaptradeClient("t").listAllActivities("acc-1");
    expect(first).toMatchObject({ institution: "X" });
  });

  it("distinguishes a rejected token, an API error, and a bad response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "expired" }, 401)));
    await expect(snaptradeClient("t").listAccounts()).rejects.toBeInstanceOf(SnapTradeUnauthorizedError);

    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "gone" }, 410)));
    await expect(snaptradeClient("t").listAccounts()).rejects.toBeInstanceOf(SnapTradeApiError);

    vi.stubGlobal("fetch", vi.fn(async () => json([{ id: 5 }])));
    await expect(snaptradeClient("t").listAccounts()).rejects.toBeInstanceOf(SnapTradeResponseError);
  });

  it("never puts the token in an error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 500)));
    const error = await snaptradeClient("secret-token", { retryDelaysMs: [] }).listBalances("acc-1").catch((e: unknown) => e);
    expect(String(error)).not.toContain("secret-token");
  });

  it("retries a rate limit or a server error, then succeeds", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json([]));
    vi.stubGlobal("fetch", fetchMock);
    expect(await snaptradeClient("t", { retryDelaysMs: [0, 0] }).listAccounts()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a request that never answered, and gives up with a clear error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetchMock);
    const error = await snaptradeClient("t", { retryDelaysMs: [0, 0] }).listAccounts().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SnapTradeApiError);
    expect((error as SnapTradeApiError).status).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never retries a rejected token or a client error", async () => {
    const fetchMock = vi.fn(async () => json({}, 401));
    vi.stubGlobal("fetch", fetchMock);
    await expect(snaptradeClient("t", { retryDelaysMs: [0, 0] }).listAccounts()).rejects.toBeInstanceOf(
      SnapTradeUnauthorizedError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not wait out a long Retry-After; the next sync tries again", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "120" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(snaptradeClient("t", { retryDelaysMs: [0, 0] }).listAccounts()).rejects.toBeInstanceOf(SnapTradeApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails rather than silently dropping history when paging never ends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ data: [{ id: "a", type: "BUY" }], pagination: { offset: 0, limit: 1000, total: 10_000_000 } })),
    );
    await expect(snaptradeClient("t").listAllActivities("acc-1")).rejects.toBeInstanceOf(SnapTradeResponseError);
  });
});
