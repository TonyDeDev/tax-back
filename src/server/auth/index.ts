import "server-only";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { type Auth, createAuth } from "./config";

let cached: Auth | undefined;

/** Lazily built, like `getDb`, so builds that never handle a request need no auth env. */
export function getAuth(): Auth {
  cached ??= createAuth(getDb(), getEnv());
  return cached;
}
