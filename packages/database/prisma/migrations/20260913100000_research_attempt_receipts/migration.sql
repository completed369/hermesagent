-- Private execution journal. Neither table is trusted task-completion evidence.
CREATE TABLE business_research_attempts (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  receipt_key_hash text NOT NULL CHECK (receipt_key_hash ~ '^[a-f0-9]{64}$'),
  commitment_id text NOT NULL,
  run_version integer NOT NULL CHECK (run_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, run_id),
  UNIQUE (workspace_id, commitment_id),
  UNIQUE (workspace_id, run_id, request_digest),
  FOREIGN KEY (workspace_id, run_id) REFERENCES acp_runs("workspaceId", id),
  FOREIGN KEY (workspace_id, commitment_id) REFERENCES business_spending_commitments(workspace_id, id)
);
CREATE TABLE business_research_receipts (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  request_digest text NOT NULL,
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object' AND octet_length(receipt::text) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, run_id),
  FOREIGN KEY (workspace_id, run_id, request_digest)
    REFERENCES business_research_attempts(workspace_id, run_id, request_digest),
  CHECK ((receipt->>'workspaceId') IS NOT DISTINCT FROM workspace_id::text
    AND (receipt->>'runId') IS NOT DISTINCT FROM run_id
    AND (receipt->>'requestDigest') IS NOT DISTINCT FROM request_digest
    AND COALESCE(receipt->>'state' IN ('AWAITING_VERIFICATION', 'REJECTED', 'OUTCOME_UNKNOWN'), false)
    AND receipt ? 'state')
);
CREATE FUNCTION protect_business_research_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Retain attempt identity for the workspace lifetime; deletion must not enable a resend.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id=OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Research execution journal is immutable';
END;
$$;
CREATE TRIGGER research_attempt_immutable BEFORE UPDATE OR DELETE ON business_research_attempts
FOR EACH ROW EXECUTE FUNCTION protect_business_research_journal();
CREATE TRIGGER research_receipt_immutable BEFORE UPDATE OR DELETE ON business_research_receipts
FOR EACH ROW EXECUTE FUNCTION protect_business_research_journal();
