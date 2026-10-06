import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Better Auth core tables (Drizzle adapter, `usePlural: true`).
 * Shapes match `getAuthTables()` from `better-auth/db` (checked on 1.7.7); re-check after upgrading Better Auth.
 * `accounts` holds the Google and SnapTrade OAuth grants (encrypted tokens), not brokerage accounts (those are `brokerage_accounts`).
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    ...timestamps,
  },
  // Better Auth lowercases emails; the check makes the unique constraint case-insensitive in practice.
  () => [check("users_email_lowercase_check", sql`email = lower(email)`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps,
  },
  (t) => [index("idx_sessions_user").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [
    index("idx_accounts_user").on(t.userId),
    // `account_id` is the SnapTrade Personal user id (the id_token `sub`), which users are keyed on:
    // one SnapTrade identity can never belong to two TaxBack users.
    uniqueIndex("accounts_provider_account_key").on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("idx_verifications_identifier").on(t.identifier)],
);

/**
 * Better Auth's database-backed rate limiter (`rateLimit.storage: "database"`).
 * Serverless instances share no memory, so an in-memory limiter would reset on every cold start.
 */
export const rateLimits = pgTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  /** Epoch milliseconds, as Better Auth writes it. */
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
