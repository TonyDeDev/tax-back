import type { NextConfig } from "next";

/*
 * Pages get their headers (CSP with a nonce, HSTS, and the rest) from `src/proxy.ts`. API routes skip
 * the proxy, so they get the static ones here: no sniffing, no framing, no referrer leaks, and never
 * cached, since they answer for one signed-in user or the cron.
 */
const apiHeaders = [
  { key: "x-content-type-options", value: "nosniff" },
  { key: "x-frame-options", value: "DENY" },
  { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
  { key: "cache-control", value: "no-store" },
  { key: "strict-transport-security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Do not let `next dev` write into AGENTS.md; it is maintained by hand.
  agentRules: false,
  // No `x-powered-by: Next.js`: it only tells a scanner what to try.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/api/:path*", headers: apiHeaders }];
  },
};

export default nextConfig;
