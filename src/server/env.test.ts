import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://localhost/taxback",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts the minimum set and defaults the demo email to a reserved domain", () => {
    expect(parseEnv(base).DEMO_USER_EMAIL).toBe("demo@taxback.invalid");
  });

  it("rejects missing required variables", () => {
    expect(() => parseEnv({})).toThrow();
  });

  it("rejects a short auth secret", () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/32 characters/);
  });

  it("rejects an auth URL that is not a URL", () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_URL: "localhost" })).toThrow();
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv({ ...base, SNAPTRADE_OAUTH_CLIENT_ID: "", SNAPTRADE_OAUTH_CLIENT_SECRET: "", CRON_SECRET: "" });
    expect(env.SNAPTRADE_OAUTH_CLIENT_ID).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
  });

  it.each([
    ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    ["SNAPTRADE_OAUTH_CLIENT_ID", "SNAPTRADE_OAUTH_CLIENT_SECRET"],
  ] as const)("requires %s and %s together", (a, b) => {
    const pair = new RegExp(`${a} and ${b}`);
    expect(() => parseEnv({ ...base, [a]: "id" })).toThrow(pair);
    expect(() => parseEnv({ ...base, [b]: "secret" })).toThrow(pair);
    expect(parseEnv({ ...base, [a]: "id", [b]: "secret" })[a]).toBe("id");
  });

  it("rejects a short cron secret", () => {
    expect(() => parseEnv({ ...base, CRON_SECRET: "short" })).toThrow(/32 characters/);
  });

  it("lowercases the demo email so it matches the lowercase check on users", () => {
    expect(parseEnv({ ...base, DEMO_USER_EMAIL: "Demo@Example.COM" }).DEMO_USER_EMAIL).toBe("demo@example.com");
  });
});
