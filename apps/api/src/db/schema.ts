/**
 * Database schema for the WebToApp SaaS API.
 * Uses Drizzle ORM with PostgreSQL (via DATABASE_URL env var).
 *
 * Tables:
 *  users        — registered accounts
 *  conversions  — conversion jobs (one per submitted project)
 *  downloads    — generated installer download records
 *  api_keys     — API keys for CLI authentication
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const conversionStatusEnum = pgEnum("conversion_status", [
  "queued",
  "detecting",
  "planning",
  "transforming",
  "scaffolding",
  "installing",
  "building",
  "packaging",
  "done",
  "failed",
  "cancelled",
]);

export const planEnum = pgEnum("plan", ["free", "pro", "team", "enterprise"]);

export const targetEnum = pgEnum("target", ["windows", "linux", "mac"]);

// ── Users ─────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash"),
  plan: planEnum("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** Conversions used this calendar month */
  monthlyUsage: integer("monthly_usage").notNull().default(0),
  /** When monthlyUsage was last reset */
  usageResetAt: timestamp("usage_reset_at").defaultNow(),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── API Keys ──────────────────────────────────────────────────────────────────

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Hashed key — the raw key is only shown once at creation */
  keyHash: text("key_hash").notNull().unique(),
  /** Short prefix shown in UI: "wta_abc123…" */
  keyPrefix: text("key_prefix").notNull(),
  name: text("name").notNull().default("Default"),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Conversions ───────────────────────────────────────────────────────────────

export const conversions = pgTable("conversions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  /** Job name shown in the dashboard */
  name: text("name").notNull(),

  /** Where the source code came from */
  sourceType: text("source_type").notNull().default("github"), // "github" | "upload" | "zip"
  /** GitHub repo URL or uploaded archive path */
  sourceUrl: text("source_url"),

  /** BullMQ job ID — used to track progress */
  jobId: text("job_id"),

  status: conversionStatusEnum("status").notNull().default("queued"),

  /** Detection result JSON (from stage 01) */
  detectionResult: jsonb("detection_result"),

  /** Migration plan summary */
  planSummary: text("plan_summary"),

  /** Build targets */
  targets: text("targets").array().notNull().default([]),

  /** Path/URL to the finished installer in S3 */
  installerUrl: text("installer_url"),
  installerSize: integer("installer_size"),

  /** Error message when status = "failed" */
  errorMessage: text("error_message"),

  /** Total pipeline duration in ms */
  durationMs: integer("duration_ms"),

  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Downloads ─────────────────────────────────────────────────────────────────

export const downloads = pgTable("downloads", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversionId: text("conversion_id")
    .notNull()
    .references(() => conversions.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Presigned S3 URL */
  downloadUrl: text("download_url").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  downloadedAt: timestamp("downloaded_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Type exports ──────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Conversion = typeof conversions.$inferSelect;
export type NewConversion = typeof conversions.$inferInsert;
export type Download = typeof downloads.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
