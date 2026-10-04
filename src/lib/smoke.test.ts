import { describe, expect, it } from "vitest";
import { getEnv } from "./env";

describe("getEnv", () => {
  it("rejects missing required variables", () => {
    expect(() => getEnv()).toThrow();
  });
});
