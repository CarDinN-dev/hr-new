-- Preserve deleted user rows for history while freeing their sign-in identifiers.
UPDATE "Employee" AS employee
SET "userId" = NULL
FROM "User" AS account
WHERE employee."userId" = account.id
  AND account."deletedAt" IS NOT NULL;

UPDATE "AuthSession" AS session
SET "revokedAt" = CURRENT_TIMESTAMP
FROM "User" AS account
WHERE session."userId" = account.id
  AND session."revokedAt" IS NULL
  AND account."deletedAt" IS NOT NULL;

UPDATE "User"
SET email = id || '@deleted.invalid',
    "microsoftObjectId" = NULL,
    "passwordHash" = NULL,
    "localLoginEnabled" = false,
    "microsoftLoginEnabled" = false,
    "isActive" = false,
    "authorizationVersion" = "authorizationVersion" + 1
WHERE "deletedAt" IS NOT NULL;
