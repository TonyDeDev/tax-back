import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, isProtected, proxy } from "./proxy";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

describe("proxy", () => {
  it("sends a visitor without a session cookie to sign-in, keeping where they were going", () => {
    const response = proxy(request("/tax/2025?view=gains"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/tax/2025?view=gains");
  });

  it("lets a request with a session cookie through, leaving the real check to the page", () => {
    const response = proxy(request("/hub", "better-auth.session_token=abc.def"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not guard public pages", () => {
    expect(proxy(request("/")).headers.get("location")).toBeNull();
    expect(proxy(request("/sign-in")).headers.get("location")).toBeNull();
  });

  it("matches protected sections by path segment", () => {
    expect(isProtected("/hub")).toBe(true);
    expect(isProtected("/hub/securities/x")).toBe(true);
    expect(isProtected("/settings")).toBe(true);
    expect(isProtected("/contributions/2025")).toBe(true);
    expect(isProtected("/hubris")).toBe(false);
    expect(isProtected("/")).toBe(false);
  });

  it("sets a fresh CSP nonce and the security headers on every response", () => {
    const a = proxy(request("/")).headers;
    const b = proxy(request("/")).headers;
    const nonce = (h: Headers) => /'nonce-([^']+)'/.exec(h.get("content-security-policy") ?? "")?.[1];
    expect(nonce(a)).toBeTruthy();
    expect(nonce(a)).not.toBe(nonce(b));
    expect(a.get("x-content-type-options")).toBe("nosniff");
    expect(a.get("x-frame-options")).toBe("DENY");
    expect(a.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("allows eval only in development and blocks framing and plugins everywhere", () => {
    expect(contentSecurityPolicy("n", true)).toContain("'unsafe-eval'");
    const prod = contentSecurityPolicy("n", false);
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("upgrade-insecure-requests");
  });
});
