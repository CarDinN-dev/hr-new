UPDATE "Employee" AS employee
SET "userId" = "User".id
FROM "User"
WHERE employee."userId" IS NULL
  AND "User"."deletedAt" IS NULL
  AND lower(employee.email) = lower("User".email)
  AND NOT EXISTS (
    SELECT 1
    FROM "Employee" AS duplicate
    WHERE duplicate.id <> employee.id
      AND lower(duplicate.email) = lower(employee.email)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "Employee" AS linked
    WHERE linked."userId" = "User".id
  );
