-- Preserve existing sessions while replacing raw bearer-token storage with
-- deterministic SHA-256 digests suitable for equality lookup.
BEGIN;

ALTER TABLE "sessions" RENAME COLUMN "sessionToken" TO "tokenDigest";

UPDATE "sessions"
SET "tokenDigest" = encode(sha256(convert_to("tokenDigest", 'UTF8')), 'hex');

ALTER INDEX "sessions_sessionToken_key" RENAME TO "sessions_tokenDigest_key";

COMMIT;
