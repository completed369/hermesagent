-- Do not infer historical sender identity from mutable environment configuration.
-- Legacy rows stay unattributed and cannot become research tasks through the new reader.
ALTER TABLE ceo_slack_inbox
  ADD COLUMN founder_id uuid,
  ADD COLUMN slack_team_id text,
  ADD COLUMN slack_user_id text,
  ADD COLUMN slack_app_id text,
  ADD CONSTRAINT ceo_slack_sender_complete CHECK (
    (founder_id IS NULL AND slack_team_id IS NULL AND slack_user_id IS NULL AND slack_app_id IS NULL)
    OR (founder_id IS NOT NULL AND slack_team_id IS NOT NULL AND slack_user_id IS NOT NULL AND slack_app_id IS NOT NULL)
  );

CREATE FUNCTION protect_ceo_slack_instruction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.workspace_id,NEW.event_id,NEW.channel_id,NEW.command,NEW.instruction,
      NEW.payload_digest,NEW.founder_id,NEW.slack_team_id,NEW.slack_user_id,NEW.slack_app_id)
    IS DISTINCT FROM
    ROW(OLD.workspace_id,OLD.event_id,OLD.channel_id,OLD.command,OLD.instruction,
      OLD.payload_digest,OLD.founder_id,OLD.slack_team_id,OLD.slack_user_id,OLD.slack_app_id) THEN
    RAISE EXCEPTION 'Accepted CEO instruction and sender provenance are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ceo_slack_instruction_immutable
  BEFORE UPDATE ON ceo_slack_inbox
  FOR EACH ROW EXECUTE FUNCTION protect_ceo_slack_instruction();
