import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as s from "./schema";

/** Any Drizzle Postgres database over this schema: Neon in the app, PGlite in tests. */
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof s>;
