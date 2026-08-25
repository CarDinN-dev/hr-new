-- Attendance data is classified as HR-confidential.
-- Employee, Line Manager, and Manager roles must not retain attendance grants.
-- New installations receive the same policy from rbac-catalog.json; this migration
-- removes grants from existing installations and invalidates affected sessions.

DELETE FROM "RolePermission" AS rp
USING "RbacRole" AS role, "RbacPermission" AS permission
WHERE rp."roleId" = role.id
  AND rp."permissionId" = permission.id
  AND role.code IN ('EMPLOYEE', 'LINE_MANAGER', 'MANAGER')
  AND permission.code LIKE 'attendance.%';

UPDATE "User" AS account
SET "authorizationVersion" = account."authorizationVersion" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "UserRole" AS assignment
  JOIN "RbacRole" AS role ON role.id = assignment."roleId"
  WHERE assignment."userId" = account.id
    AND role.code IN ('EMPLOYEE', 'LINE_MANAGER', 'MANAGER')
    AND assignment."revokedAt" IS NULL
    AND (assignment."expiresAt" IS NULL OR assignment."expiresAt" > CURRENT_TIMESTAMP)
);

UPDATE "AuthSession" AS session
SET "revokedAt" = COALESCE(session."revokedAt", CURRENT_TIMESTAMP),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "UserRole" AS assignment
  JOIN "RbacRole" AS role ON role.id = assignment."roleId"
  WHERE assignment."userId" = session."userId"
    AND role.code IN ('EMPLOYEE', 'LINE_MANAGER', 'MANAGER')
    AND assignment."revokedAt" IS NULL
    AND (assignment."expiresAt" IS NULL OR assignment."expiresAt" > CURRENT_TIMESTAMP)
);
