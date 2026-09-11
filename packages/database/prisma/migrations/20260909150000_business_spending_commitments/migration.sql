-- Additional business cash controls. No workspace is funded or activated by this migration.
CREATE TABLE business_spending_accounts (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'PAUSED' CHECK (state IN ('RUNNING', 'PAUSED', 'STOPPED')),
  funding_cents bigint NOT NULL DEFAULT 0 CHECK (funding_cents >= 0),
  protected_cents bigint NOT NULL DEFAULT 0 CHECK (protected_cents >= 0),
  funding_valid_until timestamptz,
  funding_evidence text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((funding_valid_until IS NULL) = (funding_evidence IS NULL))
);

CREATE TABLE business_spending_commitments (
  workspace_id uuid NOT NULL REFERENCES business_spending_accounts(workspace_id) ON DELETE CASCADE,
  id text NOT NULL,
  purchase_group text NOT NULL CHECK (length(purchase_group) BETWEEN 1 AND 200),
  reserved_cents bigint NOT NULL CHECK (reserved_cents BETWEEN 1 AND 2500),
  actual_cents bigint CHECK (actual_cents >= 0),
  state text NOT NULL DEFAULT 'RESERVED' CHECK (state IN ('RESERVED', 'SETTLED', 'CANCELLED')),
  cost_evidence text NOT NULL CHECK (length(cost_evidence) BETWEEN 1 AND 200),
  cost_valid_until timestamptz NOT NULL,
  settlement_evidence text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  CHECK ((state = 'SETTLED' AND actual_cents IS NOT NULL AND settled_at IS NOT NULL)
    OR (state <> 'SETTLED' AND actual_cents IS NULL AND settled_at IS NULL)),
  CHECK ((state = 'RESERVED') = (settlement_evidence IS NULL))
);
CREATE INDEX business_spending_group_idx ON business_spending_commitments(workspace_id, purchase_group);

CREATE TABLE business_spending_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES business_spending_accounts(workspace_id) ON DELETE CASCADE,
  commitment_id text,
  kind text NOT NULL CHECK (kind IN ('RESERVED', 'SETTLED', 'CANCELLED', 'PAUSED', 'RESUMED', 'STOPPED')),
  cents bigint,
  evidence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Prevent retroactive edits to recognized charges or reservation identity.
CREATE FUNCTION business_commitment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'RESERVED' OR NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id
    OR NEW.purchase_group <> OLD.purchase_group OR NEW.reserved_cents <> OLD.reserved_cents
    OR NEW.cost_evidence <> OLD.cost_evidence OR NEW.cost_valid_until <> OLD.cost_valid_until
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Business commitment history is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER business_commitment_immutable_trigger BEFORE UPDATE ON business_spending_commitments
  FOR EACH ROW EXECUTE FUNCTION business_commitment_immutable();
