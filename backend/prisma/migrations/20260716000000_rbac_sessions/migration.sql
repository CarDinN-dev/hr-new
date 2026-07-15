ALTER TYPE "LeaveRequestStatus" ADD VALUE IF NOT EXISTS 'PENDING_MANAGER';
ALTER TYPE "LeaveRequestStatus" ADD VALUE IF NOT EXISTS 'PENDING_HR';

CREATE TYPE "LeaveDecisionStage" AS ENUM ('MANAGER', 'HR');
CREATE TYPE "LeaveDecisionOutcome" AS ENUM ('APPROVED', 'REJECTED');

ALTER TABLE "User"
  ADD COLUMN "authorizationVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "rbacMigratedAt" TIMESTAMP(3);

CREATE INDEX "User_authorizationVersion_idx" ON "User"("authorizationVersion");

CREATE TABLE "RbacRole" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(100) NOT NULL,
  "displayName" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RbacRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RbacRole_code_key" ON "RbacRole"("code");
CREATE INDEX "RbacRole_isActive_idx" ON "RbacRole"("isActive");
CREATE INDEX "RbacRole_createdById_idx" ON "RbacRole"("createdById");

CREATE TABLE "RbacPermission" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(160) NOT NULL,
  "displayName" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "category" VARCHAR(80) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RbacPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RbacPermission_code_key" ON "RbacPermission"("code");
CREATE INDEX "RbacPermission_category_idx" ON "RbacPermission"("category");

CREATE TABLE "RolePermission" (
  "roleId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  "assignedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId")
);

CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
CREATE INDEX "RolePermission_assignedById_idx" ON "RolePermission"("assignedById");

CREATE TABLE "UserRole" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "assignedById" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "reason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");
CREATE INDEX "UserRole_userId_revokedAt_expiresAt_idx" ON "UserRole"("userId", "revokedAt", "expiresAt");
CREATE INDEX "UserRole_roleId_revokedAt_expiresAt_idx" ON "UserRole"("roleId", "revokedAt", "expiresAt");
CREATE INDEX "UserRole_assignedById_idx" ON "UserRole"("assignedById");

CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "authorizationVersion" INTEGER NOT NULL,
  "ipHash" VARCHAR(64),
  "userAgent" VARCHAR(512),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX "AuthSession_userId_revokedAt_expiresAt_idx" ON "AuthSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

CREATE TABLE "LeaveDecision" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "stage" "LeaveDecisionStage" NOT NULL,
  "outcome" "LeaveDecisionOutcome" NOT NULL,
  "fromStatus" "LeaveRequestStatus" NOT NULL,
  "toStatus" "LeaveRequestStatus" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeaveDecision_requestId_createdAt_idx" ON "LeaveDecision"("requestId", "createdAt");
CREATE INDEX "LeaveDecision_actorUserId_createdAt_idx" ON "LeaveDecision"("actorUserId", "createdAt");

ALTER TABLE "RbacRole" ADD CONSTRAINT "RbacRole_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "RbacRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey"
  FOREIGN KEY ("permissionId") REFERENCES "RbacPermission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "RbacRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveDecision" ADD CONSTRAINT "LeaveDecision_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveDecision" ADD CONSTRAINT "LeaveDecision_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
