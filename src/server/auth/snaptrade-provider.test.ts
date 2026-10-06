import { describe, expect, it } from "vitest";
import { placeholderEmail, userFromIdToken } from "./snaptrade-provider";

/** An unsigned token: `userFromIdToken` only ever sees tokens Better Auth has already verified. */
const token = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

describe("userFromIdToken", () => {
  it("maps the SnapTrade claims to a user keyed on sub", () => {
    expect(
      userFromIdToken(token({ sub: "u-1", email: "Ana@Example.com", email_verified: true, name: "Ana", picture: "https://x/p.png" })),
    ).toEqual({
      sub: "u-1",
      id: "u-1",
      email: "ana@example.com",
      emailVerified: true,
      name: "Ana",
      image: "https://x/p.png",
    });
  });

  it("treats an unverified email as unverified", () => {
    expect(userFromIdToken(token({ sub: "u-2", email: "b@example.com", email_verified: false }))?.emailVerified).toBe(false);
  });

  it("uses a reserved placeholder when the user declined the email scope", () => {
    expect(userFromIdToken(token({ sub: "U-3" }))).toMatchObject({
      email: placeholderEmail("U-3"),
      emailVerified: false,
      name: "SnapTrade user",
    });
    expect(placeholderEmail("U-3")).toBe("snaptrade-u-3@users.taxback.invalid");
  });

  it.each([
    ["no token", undefined],
    ["an empty token", ""],
    ["a token that is not a JWT", "abc"],
    ["a payload that is not JSON", "a.%%%.c"],
    ["no sub", token({ email: "c@example.com" })],
    ["an empty sub", token({ sub: "" })],
    ["a non-string sub", token({ sub: 42 })],
  ])("fails closed on %s", (_, value) => {
    expect(userFromIdToken(value)).toBeNull();
  });
});
