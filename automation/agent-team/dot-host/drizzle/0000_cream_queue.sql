CREATE TABLE cream_jobs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, args TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, result TEXT);
--> statement-breakpoint
CREATE INDEX cream_jobs_pending ON cream_jobs (state, created_at);
--> statement-breakpoint
CREATE TABLE cream_bridge (id INTEGER PRIMARY KEY NOT NULL, seen_at INTEGER NOT NULL);
