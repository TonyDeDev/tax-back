import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a theme font size next to a text color", () => {
    expect(cn("text-body-sm", "text-primary-foreground")).toBe("text-body-sm text-primary-foreground");
  });

  it("still lets a later font size win", () => {
    expect(cn("text-body-sm", "text-caption")).toBe("text-caption");
  });
});
