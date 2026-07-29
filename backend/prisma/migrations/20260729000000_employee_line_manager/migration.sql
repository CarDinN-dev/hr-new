ALTER TABLE "Employee" ADD COLUMN "lineManagerId" TEXT;

UPDATE "Employee"
SET "lineManagerId" = "managerId"
WHERE "lineManagerId" IS NULL AND "managerId" IS NOT NULL;

CREATE INDEX "Employee_lineManagerId_idx" ON "Employee"("lineManagerId");

ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_lineManagerId_fkey"
  FOREIGN KEY ("lineManagerId") REFERENCES "Employee"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
