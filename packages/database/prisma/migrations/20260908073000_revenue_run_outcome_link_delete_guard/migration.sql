-- ADR-0166: complete append-only enforcement for outcome evidence links.
-- A workspace cascade may remove a link only after its parent revenue run is
-- gone. Direct deletion while the parent exists is rejected.

CREATE OR REPLACE FUNCTION ventureos_reject_revenue_run_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "workspaces" w WHERE w."id" = OLD."workspaceId"
    ) THEN
        RAISE EXCEPTION 'Revenue run forecasts are immutable';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_runs_delete_guard
BEFORE DELETE ON "revenue_runs"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_run_delete();

CREATE OR REPLACE FUNCTION ventureos_reject_revenue_fact_link_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF EXISTS (
            SELECT 1 FROM "revenue_runs" r WHERE r."id" = OLD."revenueRunId"
        ) THEN
            RAISE EXCEPTION 'Revenue outcome evidence links are append-only';
        END IF;
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'Revenue outcome evidence links are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_run_revenue_entries_delete_guard
BEFORE DELETE ON "revenue_run_revenue_entries"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_fact_link_change();
CREATE TRIGGER revenue_run_expenses_delete_guard
BEFORE DELETE ON "revenue_run_expenses"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_fact_link_change();
CREATE TRIGGER revenue_run_usages_delete_guard
BEFORE DELETE ON "revenue_run_usages"
FOR EACH ROW EXECUTE FUNCTION ventureos_reject_revenue_fact_link_change();
