-- Persisted session generation used to invalidate issued JWTs on logout.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
