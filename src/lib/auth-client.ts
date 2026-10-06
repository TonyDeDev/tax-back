import type { BetterAuthClientPlugin } from "better-auth/client";
import { createAuthClient } from "better-auth/react";
import type { demoPlugin } from "@/server/auth/demo-plugin";

const demoClient = () =>
  ({
    id: "demo",
    $InferServerPlugin: {} as ReturnType<typeof demoPlugin>,
    pathMethods: { "/demo/sign-in": "POST" },
    atomListeners: [{ matcher: (path) => path === "/demo/sign-in", signal: "$sessionSignal" }],
  }) satisfies BetterAuthClientPlugin;

/** Same-origin client; the base URL defaults to the current page's origin. */
export const authClient = createAuthClient({ plugins: [demoClient()] });
