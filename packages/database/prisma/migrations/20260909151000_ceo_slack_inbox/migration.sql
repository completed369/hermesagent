CREATE TABLE ceo_slack_inbox (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  channel_id text NOT NULL,
  command text NOT NULL,
  instruction text NOT NULL CHECK (length(instruction) BETWEEN 1 AND 2000),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','PROCESSING','REPLY_READY','REPLIED','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_until timestamptz,
  lease_id uuid,
  reply text,
  reply_ts text,
  result_digest text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,event_id)
);
CREATE INDEX ceo_slack_queue_idx ON ceo_slack_inbox(workspace_id,state,created_at);
CREATE TABLE ceo_slack_audit (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL,
  event_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ACCEPTED','RESULT_VERIFIED','REPLIED','FAILED')),
  digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id,event_id) REFERENCES ceo_slack_inbox(workspace_id,event_id) ON DELETE CASCADE,
  UNIQUE(workspace_id,event_id,kind)
);
