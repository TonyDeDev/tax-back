import { describe, expect, it } from "vitest";
import { displayUrl, initials, linkRows, team } from "./team";

describe("linkRows", () => {
  it("renders only the links that are set, in a fixed order", () => {
    const rows = linkRows({ github: "https://github.com/a", linkedin: "https://www.linkedin.com/in/a/", email: "" });
    expect(rows.map((r) => r.kind)).toEqual(["linkedin", "github"]);
  });

  it("gives email a mailto link and shows the address itself", () => {
    expect(linkRows({ email: "a@example.com" })).toEqual([
      { kind: "email", label: "Email", href: "mailto:a@example.com", value: "a@example.com" },
    ]);
  });

  it("puts a custom link last, with its own label", () => {
    const rows = linkRows({ other: { label: "Blog", url: "https://blog.example.com/" }, x: "https://x.com/a" });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["X", "x.com/a"],
      ["Blog", "blog.example.com"],
    ]);
  });

  it("gives Michael a single LinkedIn row", () => {
    const michael = team.find((m) => m.name === "Michael Toner")!;
    expect(linkRows(michael.links).map((r) => r.kind)).toEqual(["linkedin"]);
  });
});

describe("team", () => {
  it("has no role field on anyone", () => {
    for (const member of team) expect(member).not.toHaveProperty("role");
  });
});

describe("displayUrl and initials", () => {
  it("strips the scheme, www and trailing slash", () => {
    expect(displayUrl("https://www.linkedin.com/in/tonypham06/")).toBe("linkedin.com/in/tonypham06");
  });

  it("takes the first and last initials", () => {
    expect(initials("Phuntsho Wangyal")).toBe("PW");
    expect(initials("Tony")).toBe("T");
  });
});
