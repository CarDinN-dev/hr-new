UPDATE "EmployeeDocument"
SET
  "scanStatus" = 'CLEAN',
  "scannedAt" = COALESCE("scannedAt", NOW()),
  "scanResultCode" = COALESCE("scanResultCode", 'NO_STORED_CONTENT')
WHERE "objectName" IS NULL
  AND "scanStatus" = 'PENDING';
