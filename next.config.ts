import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not let `next dev` write into AGENTS.md; it is maintained by hand.
  agentRules: false,
};

export default nextConfig;
