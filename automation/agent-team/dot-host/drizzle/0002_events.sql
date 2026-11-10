CREATE TABLE cream_subscriptions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, filters TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL, previous_secret TEXT, rotated_at INTEGER, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE cream_events (id TEXT PRIMARY KEY, name TEXT NOT NULL, occurred_at TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE cream_deliveries (event_id TEXT NOT NULL, subscription_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, last_status INTEGER, PRIMARY KEY(event_id,subscription_id));
