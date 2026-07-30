CREATE TABLE "RoleInheritance" (
    "childRoleId" TEXT NOT NULL,
    "parentRoleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleInheritance_pkey" PRIMARY KEY ("childRoleId","parentRoleId")
);

CREATE INDEX "RoleInheritance_parentRoleId_idx" ON "RoleInheritance"("parentRoleId");

ALTER TABLE "RoleInheritance" ADD CONSTRAINT "RoleInheritance_childRoleId_fkey" FOREIGN KEY ("childRoleId") REFERENCES "RbacRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleInheritance" ADD CONSTRAINT "RoleInheritance_parentRoleId_fkey" FOREIGN KEY ("parentRoleId") REFERENCES "RbacRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
