-- Adds the final application table required by the Convex migration registry.
-- Use this migration only after confirming the target already contains the
-- current UniInfo schema through 0001_session_lifetimes.
CREATE TABLE IF NOT EXISTS "analytics_events" (
  "id" integer PRIMARY KEY NOT NULL,
  "event_type" varchar NOT NULL,
  "details" jsonb,
  "user_email" varchar,
  "ip_address" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL
);
