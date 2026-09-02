-- Remove self-service performance access from all built-in role grants derived from EMPLOYEE.
DELETE FROM "RolePermission"
USING "RbacRole", "RbacPermission"
WHERE "RolePermission"."roleId" = "RbacRole"."id"
  AND "RolePermission"."permissionId" = "RbacPermission"."id"
  AND "RbacRole"."code" IN ('EMPLOYEE', 'LINE_MANAGER', 'MANAGER', 'HR', 'CPO', 'COO', 'ADMIN')
  AND "RbacPermission"."code" = 'performance.self.read';

-- Force affected users to sign in again so existing sessions cannot retain the removed permission.
UPDATE "User"
SET "authorizationVersion" = "authorizationVersion" + 1
WHERE "id" IN (
  SELECT "UserRole"."userId"
  FROM "UserRole"
  JOIN "RbacRole" ON "RbacRole"."id" = "UserRole"."roleId"
  WHERE "RbacRole"."code" IN ('EMPLOYEE', 'LINE_MANAGER', 'MANAGER', 'HR', 'CPO', 'COO', 'ADMIN')
    AND "UserRole"."revokedAt" IS NULL
    AND ("UserRole"."expiresAt" IS NULL OR "UserRole"."expiresAt" > CURRENT_TIMESTAMP)
);

UPDATE "AuthSession"
SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "revokedAt" IS NULL
  AND "userId" IN (
    SELECT "UserRole"."userId"
    FROM "UserRole"
    JOIN "RbacRole" ON "RbacRole"."id" = "UserRole"."roleId"
    WHERE "RbacRole"."code" IN ('EMPLOYEE', 'LINE_MANAGER', 'MANAGER', 'HR', 'CPO', 'COO', 'ADMIN')
      AND "UserRole"."revokedAt" IS NULL
      AND ("UserRole"."expiresAt" IS NULL OR "UserRole"."expiresAt" > CURRENT_TIMESTAMP)
  );
