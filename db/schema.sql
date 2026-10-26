-- SyncSquad Neon PostgreSQL schema (non-destructive; safe for existing rooms)
CREATE TABLE IF NOT EXISTS sync_rooms (
 id text PRIMARY KEY,
 name text NOT NULL,
 subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_members (
 id text PRIMARY KEY,
 room_id text NOT NULL REFERENCES sync_rooms(id) ON DELETE CASCADE,
 name text NOT NULL,
 role text NOT NULL DEFAULT 'member',
 token_hash text NOT NULL UNIQUE,
 color text NOT NULL DEFAULT '#6268e8',
 pin_hash text,
 pin_salt text,
 claimed_at timestamptz,
 pin_failures integer NOT NULL DEFAULT 0,
 lock_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sync_members ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE sync_members ADD COLUMN IF NOT EXISTS pin_salt text;
ALTER TABLE sync_members ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE sync_members ADD COLUMN IF NOT EXISTS pin_failures integer NOT NULL DEFAULT 0;
ALTER TABLE sync_members ADD COLUMN IF NOT EXISTS lock_until timestamptz;

CREATE TABLE IF NOT EXISTS sync_sessions (
 token_hash text PRIMARY KEY,
 member_id text NOT NULL REFERENCES sync_members(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_busy (
 room_id text NOT NULL REFERENCES sync_rooms(id) ON DELETE CASCADE,
 member_id text NOT NULL REFERENCES sync_members(id) ON DELETE CASCADE,
 day smallint NOT NULL CHECK(day BETWEEN 0 AND 6),
 slot smallint NOT NULL CHECK(slot BETWEEN 0 AND 5),
 PRIMARY KEY(member_id,day,slot)
);
CREATE TABLE IF NOT EXISTS sync_tasks (
 id text PRIMARY KEY,
 room_id text NOT NULL REFERENCES sync_rooms(id) ON DELETE CASCADE,
 title text NOT NULL,
 description text NOT NULL DEFAULT '',
 assignee_id text REFERENCES sync_members(id) ON DELETE SET NULL,
 points integer NOT NULL DEFAULT 10 CHECK(points IN (10,25,50)),
 difficulty text NOT NULL DEFAULT 'easy' CHECK(difficulty IN ('easy','medium','hard')),
 deadline date,
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','progress','review','done')),
 proof_url text NOT NULL DEFAULT '',
 verified_by text REFERENCES sync_members(id) ON DELETE SET NULL,
 verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_tasks_room_idx ON sync_tasks(room_id);
CREATE INDEX IF NOT EXISTS sync_members_room_idx ON sync_members(room_id);
CREATE INDEX IF NOT EXISTS sync_busy_room_idx ON sync_busy(room_id);
CREATE INDEX IF NOT EXISTS sync_sessions_member_idx ON sync_sessions(member_id);
CREATE INDEX IF NOT EXISTS sync_sessions_expiry_idx ON sync_sessions(expires_at);
