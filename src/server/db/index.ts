import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/** The WebSocket driver, not neon-http: recompute replaces derived rows inside an interactive transaction. */
function connect() {
  return drizzle({ client: new Pool({ connectionString: getEnv().DATABASE_URL }), schema });
}

export type Db = ReturnType<typeof connect>;

let cached: Db | undefined;

/** Lazily connects so builds and tests that never touch the database do not need `DATABASE_URL`. */
export function getDb(): Db {
  cached ??= connect();
  return cached;
}
