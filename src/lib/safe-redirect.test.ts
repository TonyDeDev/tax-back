import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-redirect";

describe("safeNext", () => {
  it.each(["/hub", "/tax/2025?view=gains", "/hub/securities/abc#acb", "/hub/%0a"])("keeps the local path %s", (path) => {
    expect(safeNext(path)).toBe(path);
  });

  it.each([
    null,
    undefined,
    "",
    "hub",
    "//evil.com",
    "/\\evil.com",
    "/x\\..\\/evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\tevil",
    "/\nevil",
  ])("falls back to /hub for %j", (value) => {
    expect(safeNext(value)).toBe("/hub");
  });
});
