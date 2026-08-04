-- Normalize historical identities before application queries become
-- normalization-only. Fail explicitly rather than silently merging two
-- pre-existing rows that differ only by case or surrounding whitespace.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "users"
        GROUP BY LOWER(BTRIM("email"))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot normalize user emails: case-insensitive duplicates exist';
    END IF;
END $$;

UPDATE "users"
SET "email" = LOWER(BTRIM("email"))
WHERE "email" <> LOWER(BTRIM("email"));

ALTER TABLE "users"
    ADD CONSTRAINT "users_email_normalized_check"
    CHECK ("email" = LOWER(BTRIM("email")));

-- Durable authentication abuse state shared by every API instance.
-- keyDigest contains only domain-separated HMAC-SHA-256 identifiers; raw
-- account identifiers, source IPs, passwords, and session tokens are excluded.
CREATE TABLE "auth_abuse_states" (
    "channel" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyDigest" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "cooldownLevel" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_abuse_states_pkey" PRIMARY KEY ("channel", "scope", "keyDigest"),
    CONSTRAINT "auth_abuse_states_attemptCount_check" CHECK ("attemptCount" >= 0),
    CONSTRAINT "auth_abuse_states_cooldownLevel_check" CHECK ("cooldownLevel" BETWEEN 0 AND 3),
    CONSTRAINT "auth_abuse_states_channel_check" CHECK ("channel" IN ('LOGIN', 'REGISTER')),
    CONSTRAINT "auth_abuse_states_scope_check" CHECK ("scope" IN ('ACCOUNT', 'IP'))
);

CREATE INDEX "auth_abuse_states_expiresAt_idx" ON "auth_abuse_states"("expiresAt");
