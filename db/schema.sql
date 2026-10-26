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


-- Multiple independent projects inside one existing student room.
-- Migration is non-destructive: preserves prior rooms and assigns existing tasks to "Đồ án chính".
CREATE TABLE IF NOT EXISTS sync_projects (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES sync_rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  created_by text REFERENCES sync_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_projects_room_name_unique ON sync_projects(room_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS sync_projects_room_id_unique ON sync_projects(room_id,id);
CREATE INDEX IF NOT EXISTS sync_projects_room_idx ON sync_projects(room_id);
INSERT INTO sync_projects(id,room_id,name,description,is_default)
SELECT 'prj-' || id, id, 'Đồ án chính', 'Đồ án đầu tiên trong nhóm', true FROM sync_rooms
ON CONFLICT(id) DO NOTHING;
ALTER TABLE sync_tasks ADD COLUMN IF NOT EXISTS project_id text REFERENCES sync_projects(id);
UPDATE sync_tasks SET project_id='prj-' || room_id WHERE project_id IS NULL;
ALTER TABLE sync_tasks ALTER COLUMN project_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS sync_tasks_project_idx ON sync_tasks(project_id);
