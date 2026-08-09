UPDATE "OrganizationSettings"
SET
  "phone" = '+974 4443 4140',
  "version" = "version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default'
  AND "phone" IS DISTINCT FROM '+974 4443 4140';
