-- Durable Agent Control Plane objective/task/run spine. This migration creates
-- no controller, runtime dispatch, provider, deployment, or external action.

CREATE TABLE "acp_objectives" (
  "id" TEXT NOT NULL, "workspaceId" UUID NOT NULL, "title" TEXT NOT NULL,
  "desiredOutcome" TEXT NOT NULL, "maximumAuthority" INTEGER NOT NULL,
  "currency" TEXT NOT NULL, "maximumCostMinorUnits" BIGINT NOT NULL,
  "maximumComputeUnits" BIGINT NOT NULL, "acceptanceCriteria" TEXT[] NOT NULL,
  "verificationCriteria" TEXT[] NOT NULL, "stopConditions" TEXT[] NOT NULL,
  "policyVersion" TEXT NOT NULL, "policyHash" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "acp_objectives_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_objectives_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "acp_objectives_authority_check" CHECK ("maximumAuthority" BETWEEN 0 AND 4),
  CONSTRAINT "acp_objectives_budget_check" CHECK ("maximumCostMinorUnits" >= 0 AND "maximumComputeUnits" >= 0),
  CONSTRAINT "acp_objectives_version_check" CHECK ("version" > 0),
  CONSTRAINT "acp_objectives_hash_check" CHECK ("policyHash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "acp_objectives_workspaceId_idempotencyKey_key" ON "acp_objectives"("workspaceId", "idempotencyKey");
CREATE INDEX "acp_objectives_workspaceId_status_createdAt_idx" ON "acp_objectives"("workspaceId", "status", "createdAt" DESC);

CREATE TABLE "acp_projects" (
  "id" TEXT NOT NULL, "workspaceId" UUID NOT NULL, "objectiveId" TEXT NOT NULL,
  "title" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "acp_projects_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_projects_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "acp_projects_objective_fkey" FOREIGN KEY ("workspaceId", "objectiveId") REFERENCES "acp_objectives"("workspaceId", "id") ON DELETE CASCADE,
  CONSTRAINT "acp_projects_version_check" CHECK ("version" > 0)
);
CREATE INDEX "acp_projects_workspaceId_objectiveId_idx" ON "acp_projects"("workspaceId", "objectiveId");

CREATE TABLE "acp_tasks" (
  "id" TEXT NOT NULL, "workspaceId" UUID NOT NULL, "objectiveId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL,
  "requiredAuthority" INTEGER NOT NULL, "currency" TEXT NOT NULL,
  "maximumCostMinorUnits" BIGINT NOT NULL, "maximumComputeUnits" BIGINT NOT NULL,
  "estimatedDurationMs" BIGINT NOT NULL, "acceptanceCriteria" TEXT[] NOT NULL,
  "verificationCriteria" TEXT[] NOT NULL, "stopConditions" TEXT[] NOT NULL,
  "maximumAttempts" INTEGER NOT NULL, "retryableFailureCodes" TEXT[] NOT NULL,
  "stopAfterFailureCodes" TEXT[] NOT NULL, "agentPolicy" JSONB NOT NULL,
  "routingPolicy" JSONB NOT NULL, "exactTarget" TEXT, "approvalActionCode" TEXT,
  "approvalArtifactVersion" TEXT, "approvalEvidenceHash" TEXT, "policyVersion" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL, "assignedAgentId" TEXT, "assignedRuntimeId" TEXT,
  "assignedConnectionId" TEXT, "attempt" INTEGER NOT NULL DEFAULT 0, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "acp_tasks_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_tasks_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "acp_tasks_objective_fkey" FOREIGN KEY ("workspaceId", "objectiveId") REFERENCES "acp_objectives"("workspaceId", "id") ON DELETE CASCADE,
  CONSTRAINT "acp_tasks_project_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "acp_projects"("workspaceId", "id") ON DELETE CASCADE,
  CONSTRAINT "acp_tasks_status_check" CHECK ("status" IN ('BLOCKED','READY','AWAITING_APPROVAL','ASSIGNED','RUNNING','COMPLETED','FAILED','STOPPED')),
  CONSTRAINT "acp_tasks_authority_check" CHECK ("requiredAuthority" BETWEEN 0 AND 4),
  CONSTRAINT "acp_tasks_budget_check" CHECK ("maximumCostMinorUnits" >= 0 AND "maximumComputeUnits" >= 0 AND "estimatedDurationMs" > 0),
  CONSTRAINT "acp_tasks_attempt_check" CHECK ("maximumAttempts" BETWEEN 1 AND 32 AND "attempt" BETWEEN 0 AND "maximumAttempts"),
  CONSTRAINT "acp_tasks_version_check" CHECK ("version" > 0),
  CONSTRAINT "acp_tasks_hash_check" CHECK ("policyHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "acp_tasks_level4_binding_check" CHECK (
    ("requiredAuthority" = 4 AND "approvalActionCode" IS NOT NULL AND "exactTarget" IS NOT NULL AND "approvalArtifactVersion" IS NOT NULL AND "approvalEvidenceHash" ~ '^[a-f0-9]{64}$') OR
    ("requiredAuthority" <> 4 AND "approvalActionCode" IS NULL AND "exactTarget" IS NULL AND "approvalArtifactVersion" IS NULL AND "approvalEvidenceHash" IS NULL)
  )
);
CREATE INDEX "acp_tasks_workspaceId_objectiveId_status_idx" ON "acp_tasks"("workspaceId", "objectiveId", "status");
CREATE INDEX "acp_tasks_workspaceId_projectId_status_idx" ON "acp_tasks"("workspaceId", "projectId", "status");

CREATE TABLE "acp_task_dependencies" (
  "workspaceId" UUID NOT NULL, "taskId" TEXT NOT NULL, "dependsOnTaskId" TEXT NOT NULL,
  CONSTRAINT "acp_task_dependencies_pkey" PRIMARY KEY ("workspaceId", "taskId", "dependsOnTaskId"),
  CONSTRAINT "acp_task_dependencies_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "acp_task_dependencies_task_fkey" FOREIGN KEY ("workspaceId", "taskId") REFERENCES "acp_tasks"("workspaceId", "id") ON DELETE CASCADE,
  CONSTRAINT "acp_task_dependencies_depends_fkey" FOREIGN KEY ("workspaceId", "dependsOnTaskId") REFERENCES "acp_tasks"("workspaceId", "id") ON DELETE CASCADE,
  CONSTRAINT "acp_task_dependencies_not_self_check" CHECK ("taskId" <> "dependsOnTaskId")
);
CREATE INDEX "acp_task_dependencies_workspaceId_dependsOnTaskId_idx" ON "acp_task_dependencies"("workspaceId", "dependsOnTaskId");

CREATE TABLE "acp_runs" (
  "id" TEXT NOT NULL, "workspaceId" UUID NOT NULL, "objectiveId" TEXT NOT NULL, "taskId" TEXT NOT NULL,
  "status" TEXT NOT NULL, "requiredAuthority" INTEGER NOT NULL, "policyVersion" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL, "actionCode" TEXT, "exactTarget" TEXT, "artifactVersionId" TEXT,
  "evidenceHash" TEXT, "assignedAgentId" TEXT, "assignedRuntimeId" TEXT,
  "assignedConnectionId" TEXT, "assignmentEvidenceId" TEXT, "assignmentEvidenceHash" TEXT, "assignmentIdempotencyKey" TEXT,
  "attempt" INTEGER NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  CONSTRAINT "acp_runs_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_runs_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "acp_runs_task_fkey" FOREIGN KEY ("workspaceId", "taskId") REFERENCES "acp_tasks"("workspaceId", "id") ON DELETE CASCADE,
  CONSTRAINT "acp_runs_status_check" CHECK ("status" IN ('PREPARED','AWAITING_APPROVAL','ASSIGNED','RUNNING','COMPLETED','FAILED','STOPPED')),
  CONSTRAINT "acp_runs_authority_check" CHECK ("requiredAuthority" BETWEEN 0 AND 4),
  CONSTRAINT "acp_runs_attempt_check" CHECK ("attempt" > 0),
  CONSTRAINT "acp_runs_version_check" CHECK ("version" > 0),
  CONSTRAINT "acp_runs_hash_check" CHECK ("policyHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "acp_runs_binding_check" CHECK (
    ("requiredAuthority" = 4 AND "status" IN ('AWAITING_APPROVAL','STOPPED') AND "assignedAgentId" IS NULL AND "assignedRuntimeId" IS NULL AND "assignedConnectionId" IS NULL AND "actionCode" IS NOT NULL AND "exactTarget" IS NOT NULL AND "artifactVersionId" IS NOT NULL AND "evidenceHash" ~ '^[a-f0-9]{64}$') OR
    ("requiredAuthority" <> 4 AND "actionCode" IS NULL AND "exactTarget" IS NULL AND "artifactVersionId" IS NULL AND "evidenceHash" IS NULL)
  )
);
CREATE UNIQUE INDEX "acp_runs_workspaceId_idempotencyKey_key" ON "acp_runs"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "acp_runs_workspaceId_assignmentIdempotencyKey_key" ON "acp_runs"("workspaceId", "assignmentIdempotencyKey");
CREATE INDEX "acp_runs_workspaceId_objectiveId_status_idx" ON "acp_runs"("workspaceId", "objectiveId", "status");
CREATE INDEX "acp_runs_workspaceId_taskId_status_idx" ON "acp_runs"("workspaceId", "taskId", "status");
CREATE UNIQUE INDEX "acp_runs_one_active_per_task_idx" ON "acp_runs"("workspaceId", "taskId") WHERE "status" IN ('PREPARED','AWAITING_APPROVAL','ASSIGNED','RUNNING');

CREATE TABLE "acp_artifacts" (
  "id" TEXT NOT NULL, "workspaceId" UUID NOT NULL, "objectiveId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL, "runId" TEXT NOT NULL, "criterion" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "uriReference" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "sourceEvidenceId" TEXT NOT NULL, "evidenceHash" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_artifacts_pkey" PRIMARY KEY ("workspaceId", "id"),
  CONSTRAINT "acp_artifacts_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "acp_artifacts_task_fkey" FOREIGN KEY ("workspaceId", "taskId") REFERENCES "acp_tasks"("workspaceId", "id") ON DELETE CASCADE,
  CONSTRAINT "acp_artifacts_run_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "acp_runs"("workspaceId", "id") ON DELETE CASCADE,
  CONSTRAINT "acp_artifacts_hash_check" CHECK ("contentHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "acp_artifacts_workspaceId_idempotencyKey_key" ON "acp_artifacts"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "acp_artifacts_workspaceId_runId_criterion_key" ON "acp_artifacts"("workspaceId", "runId", "criterion");
CREATE INDEX "acp_artifacts_workspaceId_runId_createdAt_idx" ON "acp_artifacts"("workspaceId", "runId", "createdAt" DESC);

CREATE OR REPLACE FUNCTION ventureos_acp_immutable_policy() RETURNS trigger AS $$
BEGIN
  IF OLD."workspaceId" IS DISTINCT FROM NEW."workspaceId" OR OLD."id" IS DISTINCT FROM NEW."id" OR
     to_jsonb(OLD) - ARRAY['status','version','updatedAt','completedAt','assignedAgentId','assignedRuntimeId','assignedConnectionId','attempt']
     IS DISTINCT FROM
     to_jsonb(NEW) - ARRAY['status','version','updatedAt','completedAt','assignedAgentId','assignedRuntimeId','assignedConnectionId','attempt'] THEN
    RAISE EXCEPTION 'ACP durable policy and binding fields are immutable';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'ACP version must increment exactly once'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acp_tasks_immutable_policy BEFORE UPDATE ON "acp_tasks"
FOR EACH ROW EXECUTE FUNCTION ventureos_acp_immutable_policy();

CREATE OR REPLACE FUNCTION ventureos_acp_task_transition_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = NEW."status" THEN RETURN NEW; END IF;
  IF NOT ((OLD."status" = 'BLOCKED' AND NEW."status" IN ('READY','AWAITING_APPROVAL','STOPPED')) OR
          (OLD."status" = 'READY' AND NEW."status" IN ('ASSIGNED','STOPPED')) OR
          (OLD."status" = 'AWAITING_APPROVAL' AND NEW."status" = 'STOPPED') OR
          (OLD."status" = 'ASSIGNED' AND NEW."status" IN ('READY','RUNNING','FAILED','STOPPED')) OR
          (OLD."status" = 'RUNNING' AND NEW."status" IN ('READY','COMPLETED','FAILED','STOPPED'))) THEN
    RAISE EXCEPTION 'Illegal ACP task state transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_tasks_transition_guard BEFORE UPDATE ON "acp_tasks"
FOR EACH ROW EXECUTE FUNCTION ventureos_acp_task_transition_guard();

CREATE OR REPLACE FUNCTION ventureos_acp_task_binding_guard() RETURNS trigger AS $$
DECLARE project_objective TEXT;
BEGIN
  SELECT "objectiveId" INTO project_objective FROM "acp_projects"
  WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."projectId";
  IF NOT FOUND OR project_objective <> NEW."objectiveId" THEN
    RAISE EXCEPTION 'ACP task project/objective binding mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_tasks_binding_guard BEFORE INSERT ON "acp_tasks"
FOR EACH ROW EXECUTE FUNCTION ventureos_acp_task_binding_guard();

CREATE OR REPLACE FUNCTION ventureos_acp_dependency_guard() RETURNS trigger AS $$
DECLARE task_objective TEXT; dependency_objective TEXT; creates_cycle BOOLEAN;
BEGIN
  SELECT "objectiveId" INTO task_objective FROM "acp_tasks" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."taskId";
  SELECT "objectiveId" INTO dependency_objective FROM "acp_tasks" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."dependsOnTaskId";
  IF task_objective IS NULL OR dependency_objective IS NULL OR task_objective <> dependency_objective THEN
    RAISE EXCEPTION 'ACP dependency must remain inside one objective';
  END IF;
  WITH RECURSIVE ancestors("taskId") AS (
    SELECT NEW."dependsOnTaskId"
    UNION
    SELECT dependency."dependsOnTaskId" FROM "acp_task_dependencies" dependency
    JOIN ancestors ON dependency."taskId" = ancestors."taskId"
    WHERE dependency."workspaceId" = NEW."workspaceId"
  ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE "taskId" = NEW."taskId") INTO creates_cycle;
  IF creates_cycle THEN RAISE EXCEPTION 'ACP dependency graph cycle denied'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_dependencies_guard BEFORE INSERT ON "acp_task_dependencies"
FOR EACH ROW EXECUTE FUNCTION ventureos_acp_dependency_guard();

CREATE OR REPLACE FUNCTION ventureos_acp_run_guard() RETURNS trigger AS $$
DECLARE task_row "acp_tasks"%ROWTYPE;
BEGIN
  SELECT * INTO task_row FROM "acp_tasks" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."taskId";
  IF NOT FOUND OR task_row."objectiveId" <> NEW."objectiveId" OR task_row."requiredAuthority" <> NEW."requiredAuthority" OR task_row."policyHash" <> NEW."policyHash" OR task_row."policyVersion" <> NEW."policyVersion" THEN
    RAISE EXCEPTION 'ACP run binding does not match its task';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) - ARRAY['status','assignedAgentId','assignedRuntimeId','assignedConnectionId','assignmentEvidenceId','assignmentEvidenceHash','assignmentIdempotencyKey','version','updatedAt','startedAt','completedAt']
       IS DISTINCT FROM
       to_jsonb(NEW) - ARRAY['status','assignedAgentId','assignedRuntimeId','assignedConnectionId','assignmentEvidenceId','assignmentEvidenceHash','assignmentIdempotencyKey','version','updatedAt','startedAt','completedAt'] THEN
      RAISE EXCEPTION 'ACP run binding fields are immutable';
    END IF;
    IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'ACP run version must increment exactly once'; END IF;
    IF NOT ((OLD."status" = 'PREPARED' AND NEW."status" IN ('ASSIGNED','STOPPED')) OR
            (OLD."status" = 'AWAITING_APPROVAL' AND NEW."status" = 'STOPPED') OR
            (OLD."status" = 'ASSIGNED' AND NEW."status" IN ('RUNNING','FAILED','STOPPED')) OR
            (OLD."status" = 'RUNNING' AND NEW."status" IN ('COMPLETED','FAILED','STOPPED'))) THEN
      RAISE EXCEPTION 'Illegal ACP run state transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_runs_guard BEFORE INSERT OR UPDATE ON "acp_runs"
FOR EACH ROW EXECUTE FUNCTION ventureos_acp_run_guard();

CREATE OR REPLACE FUNCTION ventureos_acp_artifact_guard() RETURNS trigger AS $$
DECLARE run_row "acp_runs"%ROWTYPE;
BEGIN
  SELECT * INTO run_row FROM "acp_runs" WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."runId";
  IF NOT FOUND OR run_row."taskId" <> NEW."taskId" OR run_row."objectiveId" <> NEW."objectiveId" THEN
    RAISE EXCEPTION 'ACP artifact binding does not match its run';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_artifacts_guard BEFORE INSERT ON "acp_artifacts"
FOR EACH ROW EXECUTE FUNCTION ventureos_acp_artifact_guard();

CREATE OR REPLACE FUNCTION ventureos_acp_reject_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'ACP evidence rows are immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER acp_artifacts_immutable BEFORE UPDATE ON "acp_artifacts"
FOR EACH ROW EXECUTE FUNCTION ventureos_acp_reject_update();
CREATE TRIGGER acp_dependencies_immutable BEFORE UPDATE ON "acp_task_dependencies"
FOR EACH ROW EXECUTE FUNCTION ventureos_acp_reject_update();
CREATE TRIGGER acp_objectives_immutable BEFORE UPDATE ON "acp_objectives"
FOR EACH ROW EXECUTE FUNCTION ventureos_acp_reject_update();
CREATE TRIGGER acp_projects_immutable BEFORE UPDATE ON "acp_projects"
FOR EACH ROW EXECUTE FUNCTION ventureos_acp_reject_update();
