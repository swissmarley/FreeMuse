CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  password_hash text NOT NULL,
  birth_year int NOT NULL,              -- data minimisation: only the year is kept
  age_verified_at timestamptz NOT NULL,
  onboarded boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}',
  avatar jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL DEFAULT 'default',
  role text NOT NULL,
  text text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]',
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX messages_conv ON messages(user_id, conversation_id, created_at);

-- Raw model items (incl. encrypted reasoning) for stateless replay.
CREATE TABLE turn_items (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread text NOT NULL,                -- 'conv:<id>' or 'task:<id>'
  turn_id text NOT NULL,
  item jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX turn_items_thread ON turn_items(user_id, thread, id);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL DEFAULT 'default',
  title text NOT NULL,
  goal text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  plan jsonb NOT NULL DEFAULT '[]',
  progress real NOT NULL DEFAULT 0,
  next_run_at timestamptz,
  result text,
  state jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_user ON tasks(user_id, updated_at DESC);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  thread text,
  call_id text,
  action_class text NOT NULL,
  connector text NOT NULL,
  operation text NOT NULL,
  title text NOT NULL,
  preview jsonb NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  risk jsonb NOT NULL,
  sentinel jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX approvals_user ON approvals(user_id, status, created_at DESC);

-- Append-only, hash-chained audit trail.
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  actor text NOT NULL,
  summary text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  prev_hash text NOT NULL,
  hash text NOT NULL
);
CREATE INDEX audit_user ON audit_events(user_id, seq DESC);

CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_events is append-only';
  END IF;
  -- deletes are allowed only for GDPR erasure (explicit flag) or cascading user deletion
  IF TG_OP = 'DELETE' AND coalesce(current_setting('muse.erase', true), '') <> 'on' THEN
    RAISE EXCEPTION 'audit_events is append-only (erase requires muse.erase=on)';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_append_only();

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL,
  kind text NOT NULL DEFAULT 'fact',
  source text NOT NULL DEFAULT 'conversation',
  importance real NOT NULL DEFAULT 0.5,
  embedding vector(256),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX memories_user ON memories(user_id);
CREATE INDEX memories_tsv ON memories USING gin(tsv);
CREATE INDEX memories_vec ON memories USING hnsw (embedding vector_cosine_ops);

CREATE TABLE suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text text NOT NULL,
  basis jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vault_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,                  -- login | oauth | payment
  service text NOT NULL,
  username text NOT NULL DEFAULT '',
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  wrapped_dek bytea NOT NULL,
  dek_nonce bytea NOT NULL,
  key_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, service, username)
);

CREATE TABLE connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector text NOT NULL,
  scopes text[] NOT NULL,
  account text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  vault_id uuid REFERENCES vault_items(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, connector)
);

CREATE TABLE oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector text NOT NULL,
  scopes text[] NOT NULL,
  code_verifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  token jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, token)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  url text NOT NULL DEFAULT '/',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime text NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Local "Demo Mail / Demo Calendar" connector storage (no external accounts needed).
CREATE TABLE demo_mail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder text NOT NULL,
  from_addr text NOT NULL,
  to_addrs text[] NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  unread boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE demo_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  location text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  attendees text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
  provider text NOT NULL,
  merchant text NOT NULL,
  description text NOT NULL,
  amount_cents int NOT NULL,
  currency text NOT NULL,
  card_last4 text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Sentinel's own decision log (written with the sentinel role).
CREATE TABLE sentinel_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_hash text NOT NULL,
  action_class text NOT NULL,
  decision text NOT NULL,
  reasons jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE egress_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  host text NOT NULL,
  allowed boolean NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Least-privilege role for the Sentinel service (created by infra/postgres init when configured).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'muse_sentinel') THEN
    GRANT SELECT (id, settings) ON users TO muse_sentinel;
    GRANT SELECT ON connections TO muse_sentinel;
    GRANT SELECT, INSERT ON sentinel_decisions, egress_log TO muse_sentinel;
    GRANT USAGE ON SEQUENCE egress_log_id_seq TO muse_sentinel;
  END IF;
END $$;
