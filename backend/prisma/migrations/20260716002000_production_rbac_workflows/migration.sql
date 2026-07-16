-- Clean-cut reset of the workflow, authorization, session, payroll, and audit records covered by this migration.
-- Employee, organization, attendance, loan, and other unaffected HR records are preserved.
TRUNCATE TABLE "AuditChange", "AuditEvent", "LeaveDecision", "LeaveRequest", "PayrollLineItem", "LoanRepayment", "Payroll", "AuthSession", "RolePermission", "UserRole" CASCADE;
DELETE FROM "RbacRole";
DELETE FROM "RbacPermission";

-- CreateEnum
CREATE TYPE "RoleProtection" AS ENUM ('STANDARD', 'PROTECTED', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "PermissionOverrideEffect" AS ENUM ('GRANT', 'DENY');

-- CreateEnum
CREATE TYPE "AccessScopeType" AS ENUM ('SELF', 'DIRECT_REPORTS', 'MANAGEMENT_TREE', 'ASSIGNED_APPROVALS', 'ALL_EMPLOYEES', 'ALL_SYSTEM');

-- CreateEnum
CREATE TYPE "LeaveApprovalStage" AS ENUM ('LINE_MANAGER', 'MANAGER', 'HR', 'CPO', 'COO');

-- CreateEnum
CREATE TYPE "LeaveRouteType" AS ENUM ('STANDARD', 'CPO_TO_COO', 'COO_SELF');

-- CreateEnum
CREATE TYPE "LeaveStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'REASSIGNED');

-- CreateEnum
CREATE TYPE "LeaveDecisionType" AS ENUM ('APPROVE', 'REJECT', 'RETURN', 'SELF_APPROVE', 'OVERRIDE', 'CANCEL', 'REASSIGN');

-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('LEAVE');

-- CreateEnum
CREATE TYPE "ApproverMode" AS ENUM ('PRIMARY_APPROVER', 'ANY_ONE', 'NAMED_POOL');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('GENERATED', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceRequestType" AS ENUM ('SALARY_CERTIFICATE', 'EXPERIENCE_CERTIFICATE', 'CLEARANCE_CERTIFICATE');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('SUBMITTED', 'IN_HR_REVIEW', 'GENERATED', 'PENDING_HR_APPROVAL', 'APPROVED', 'PUBLISHED', 'REJECTED', 'CANCELLED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ServiceRequestEventType" AS ENUM ('SUBMITTED', 'REVIEW_STARTED', 'GENERATED', 'SENT_FOR_APPROVAL', 'APPROVED', 'PUBLISHED', 'REJECTED', 'CANCELLED', 'REVOKED', 'REGENERATED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditExportFormat" AS ENUM ('CSV', 'PDF');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'DOWNLOAD';
ALTER TYPE "AuditAction" ADD VALUE 'EXPORT';
ALTER TYPE "AuditAction" ADD VALUE 'OVERRIDE';
ALTER TYPE "AuditAction" ADD VALUE 'REVOKE';

-- AlterEnum
BEGIN;
CREATE TYPE "LeaveRequestStatus_new" AS ENUM ('PENDING_LINE_MANAGER', 'PENDING_MANAGER', 'PENDING_HR', 'PENDING_CPO', 'PENDING_COO', 'RETURNED_FOR_CORRECTION', 'BLOCKED_APPROVER_MISSING', 'APPROVED', 'REJECTED', 'CANCELLED');
ALTER TABLE "LeaveRequest" ALTER COLUMN "status" TYPE "LeaveRequestStatus_new" USING ("status"::text::"LeaveRequestStatus_new");
ALTER TABLE "LeaveDecision" ALTER COLUMN "fromStatus" TYPE "LeaveRequestStatus_new" USING ("fromStatus"::text::"LeaveRequestStatus_new");
ALTER TABLE "LeaveDecision" ALTER COLUMN "toStatus" TYPE "LeaveRequestStatus_new" USING ("toStatus"::text::"LeaveRequestStatus_new");
ALTER TYPE "LeaveRequestStatus" RENAME TO "LeaveRequestStatus_old";
ALTER TYPE "LeaveRequestStatus_new" RENAME TO "LeaveRequestStatus";
DROP TYPE "LeaveRequestStatus_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "LeaveRequest" DROP CONSTRAINT "LeaveRequest_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "LeaveRequest" DROP CONSTRAINT "LeaveRequest_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "LeaveRequest" DROP CONSTRAINT "LeaveRequest_managerId_fkey";

-- DropForeignKey
ALTER TABLE "Payroll" DROP CONSTRAINT "Payroll_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "Payroll" DROP CONSTRAINT "Payroll_employeeId_fkey";

-- DropIndex
DROP INDEX "AuditEvent_actorUserId_idx";

-- DropIndex
DROP INDEX "AuditEvent_createdAt_idx";

-- DropIndex
DROP INDEX "AuditEvent_entityType_entityId_idx";

-- DropIndex
DROP INDEX "LeaveRequest_approvedById_idx";

-- DropIndex
DROP INDEX "LeaveRequest_employeeId_idx";

-- DropIndex
DROP INDEX "LeaveRequest_managerId_idx";

-- DropIndex
DROP INDEX "LeaveRequest_status_idx";

-- DropIndex
DROP INDEX "Payroll_deletedAt_idx";

-- DropIndex
DROP INDEX "Payroll_employeeId_idx";

-- DropIndex
DROP INDEX "Payroll_employeeId_year_month_key";

-- DropIndex
DROP INDEX "Payroll_status_idx";

-- DropIndex
DROP INDEX "Payroll_year_month_idx";

-- DropIndex
DROP INDEX "User_role_idx";

-- AlterTable
ALTER TABLE "Announcement" DROP COLUMN "audienceRoles",
ADD COLUMN     "audienceRoleCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "AuditEvent" DROP COLUMN "createdAt",
DROP COLUMN "entityId",
DROP COLUMN "entityType",
DROP COLUMN "summary",
ADD COLUMN     "actorEmailSnapshot" TEXT,
ADD COLUMN     "actorEmployeeId" TEXT,
ADD COLUMN     "actorNameSnapshot" TEXT,
ADD COLUMN     "actorRoleCodesSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "afterJson" JSONB,
ADD COLUMN     "beforeJson" JSONB,
ADD COLUMN     "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "eventHash" TEXT NOT NULL,
ADD COLUMN     "httpMethod" TEXT,
ADD COLUMN     "ipHash" TEXT,
ADD COLUMN     "isOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSelfApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metadataJson" JSONB,
ADD COLUMN     "module" VARCHAR(100) NOT NULL,
ADD COLUMN     "occurredAtUtc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN     "payrollPeriod" TEXT,
ADD COLUMN     "permissionCode" TEXT,
ADD COLUMN     "previousEventHash" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "requestType" TEXT,
ADD COLUMN     "resourceId" TEXT,
ADD COLUMN     "resourceType" VARCHAR(100) NOT NULL,
ADD COLUMN     "route" TEXT,
ADD COLUMN     "scopeType" "AccessScopeType",
ADD COLUMN     "sequence" BIGINT NOT NULL,
ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "subjectDepartmentId" TEXT,
ADD COLUMN     "subjectEmployeeId" TEXT,
ADD COLUMN     "targetUserId" TEXT,
ADD COLUMN     "userAgent" TEXT,
ADD COLUMN     "workflowId" TEXT,
ADD COLUMN     "workflowStage" TEXT,
ADD COLUMN     "workflowStatus" TEXT;

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "reauthenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "LeaveDecision" DROP COLUMN "outcome",
ADD COLUMN     "decisionType" "LeaveDecisionType" NOT NULL,
ADD COLUMN     "idempotencyKey" VARCHAR(128),
ADD COLUMN     "isOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSelfApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stepId" TEXT,
DROP COLUMN "stage",
ADD COLUMN     "stage" "LeaveApprovalStage";

-- AlterTable
ALTER TABLE "LeaveRequest" DROP COLUMN "approvedAt",
DROP COLUMN "approvedById",
DROP COLUMN "managerId",
ADD COLUMN     "currentStage" "LeaveApprovalStage",
ADD COLUMN     "departmentIdSnapshot" TEXT,
ADD COLUMN     "finalDecisionAt" TIMESTAMP(3),
ADD COLUMN     "managerChainSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "requesterRoleCodesSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "requesterUserId" TEXT NOT NULL,
ADD COLUMN     "routeType" "LeaveRouteType" NOT NULL,
ADD COLUMN     "workflowVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Payroll" DROP COLUMN "approvedAt",
DROP COLUMN "approvedById",
DROP COLUMN "deletedAt",
DROP COLUMN "generatedAt",
DROP COLUMN "paidAt",
DROP COLUMN "status",
ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "objectGeneration" TEXT,
ADD COLUMN     "objectName" TEXT,
ADD COLUMN     "revocationReason" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedByUserId" TEXT,
ADD COLUMN     "runId" TEXT NOT NULL,
ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "sizeBytes" INTEGER;

-- AlterTable
ALTER TABLE "RbacPermission" ADD COLUMN     "isDeprecated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isProtected" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RbacRole" ADD COLUMN     "protection" "RoleProtection" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "permissions",
DROP COLUMN "rbacMigratedAt",
DROP COLUMN "role",
DROP COLUMN "sessionVersion",
ADD COLUMN     "localLoginEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "microsoftLoginEnabled" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- DropEnum
DROP TYPE "LeaveDecisionOutcome";

-- DropEnum
DROP TYPE "LeaveDecisionStage";

-- DropEnum
DROP TYPE "PayrollStatus";

-- DropEnum
DROP TYPE "Permission";

-- DropEnum
DROP TYPE "Role";

-- CreateTable
CREATE TABLE "UserPermissionOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" "PermissionOverrideEffect" NOT NULL,
    "scopeType" "AccessScopeType" NOT NULL,
    "scopeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "assignedById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveApprovalStep" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "workflowVersion" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "stage" "LeaveApprovalStage" NOT NULL,
    "assignedRoleCode" TEXT NOT NULL,
    "status" "LeaveStepStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionType" "LeaveDecisionType",
    "reason" TEXT,
    "selfApprovalAllowed" BOOLEAN NOT NULL DEFAULT false,
    "isSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "replacesStepId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveApprovalStepAssignee" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delegatedFromUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "LeaveApprovalStepAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStagePolicy" (
    "id" TEXT NOT NULL,
    "workflowType" "WorkflowType" NOT NULL,
    "stage" "LeaveApprovalStage" NOT NULL,
    "mode" "ApproverMode" NOT NULL,
    "primaryUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowStagePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStagePolicyMember" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowStagePolicyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDelegation" (
    "id" TEXT NOT NULL,
    "workflowType" "WorkflowType" NOT NULL,
    "stage" "LeaveApprovalStage" NOT NULL,
    "delegatorUserId" TEXT NOT NULL,
    "delegateUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'GENERATED',
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "paidAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "correctionOfId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "code" "ServiceRequestType" NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL,
    "requestType" "ServiceRequestType" NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "subjectEmployeeId" TEXT NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "requesterComment" TEXT,
    "hrComment" TEXT,
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "type" "ServiceRequestEventType" NOT NULL,
    "fromStatus" "ServiceRequestStatus",
    "toStatus" "ServiceRequestStatus" NOT NULL,
    "reason" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocumentVersion" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "objectName" TEXT NOT NULL,
    "objectGeneration" TEXT,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "resourceType" VARCHAR(100),
    "resourceId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "operation" VARCHAR(120) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "resourceType" VARCHAR(100) NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditChainState" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "lastSequence" BIGINT NOT NULL DEFAULT 0,
    "lastHash" TEXT,
    "prunedThroughSequence" BIGINT NOT NULL DEFAULT 0,
    "prunedThroughHash" TEXT,
    "prunedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditChainState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditExport" (
    "id" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "format" "AuditExportFormat" NOT NULL,
    "filtersJson" JSONB NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "objectName" TEXT NOT NULL,
    "objectGeneration" TEXT,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLegalHold" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "workflowId" TEXT,
    "subjectEmployeeId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRetentionPolicy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER NOT NULL DEFAULT 2555,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPermissionOverride_userId_revokedAt_startsAt_expiresAt_idx" ON "UserPermissionOverride"("userId", "revokedAt", "startsAt", "expiresAt");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_permissionId_effect_idx" ON "UserPermissionOverride"("permissionId", "effect");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_assignedById_idx" ON "UserPermissionOverride"("assignedById");

-- CreateIndex
CREATE INDEX "LeaveApprovalStep_requestId_status_idx" ON "LeaveApprovalStep"("requestId", "status");

-- CreateIndex
CREATE INDEX "LeaveApprovalStep_stage_status_idx" ON "LeaveApprovalStep"("stage", "status");

-- CreateIndex
CREATE INDEX "LeaveApprovalStep_decidedByUserId_idx" ON "LeaveApprovalStep"("decidedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveApprovalStep_requestId_workflowVersion_sequence_key" ON "LeaveApprovalStep"("requestId", "workflowVersion", "sequence");

-- CreateIndex
CREATE INDEX "LeaveApprovalStepAssignee_userId_isActive_idx" ON "LeaveApprovalStepAssignee"("userId", "isActive");

-- CreateIndex
CREATE INDEX "LeaveApprovalStepAssignee_delegatedFromUserId_idx" ON "LeaveApprovalStepAssignee"("delegatedFromUserId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveApprovalStepAssignee_stepId_userId_key" ON "LeaveApprovalStepAssignee"("stepId", "userId");

-- CreateIndex
CREATE INDEX "WorkflowStagePolicy_primaryUserId_idx" ON "WorkflowStagePolicy"("primaryUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStagePolicy_workflowType_stage_key" ON "WorkflowStagePolicy"("workflowType", "stage");

-- CreateIndex
CREATE INDEX "WorkflowStagePolicyMember_userId_idx" ON "WorkflowStagePolicyMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStagePolicyMember_policyId_userId_key" ON "WorkflowStagePolicyMember"("policyId", "userId");

-- CreateIndex
CREATE INDEX "WorkflowDelegation_workflowType_stage_startsAt_endsAt_revok_idx" ON "WorkflowDelegation"("workflowType", "stage", "startsAt", "endsAt", "revokedAt");

-- CreateIndex
CREATE INDEX "WorkflowDelegation_delegatorUserId_idx" ON "WorkflowDelegation"("delegatorUserId");

-- CreateIndex
CREATE INDEX "WorkflowDelegation_delegateUserId_idx" ON "WorkflowDelegation"("delegateUserId");

-- CreateIndex
CREATE INDEX "PayrollRun_status_year_month_idx" ON "PayrollRun"("status", "year", "month");

-- CreateIndex
CREATE INDEX "PayrollRun_generatedByUserId_idx" ON "PayrollRun"("generatedByUserId");

-- CreateIndex
CREATE INDEX "PayrollRun_correctionOfId_idx" ON "PayrollRun"("correctionOfId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_year_month_revision_key" ON "PayrollRun"("year", "month", "revision");

-- CreateIndex
CREATE INDEX "DocumentTemplate_code_isActive_idx" ON "DocumentTemplate"("code", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_code_version_key" ON "DocumentTemplate"("code", "version");

-- CreateIndex
CREATE INDEX "ServiceRequest_requesterUserId_createdAt_idx" ON "ServiceRequest"("requesterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceRequest_subjectEmployeeId_createdAt_idx" ON "ServiceRequest"("subjectEmployeeId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceRequest_status_createdAt_idx" ON "ServiceRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceRequest_requestType_status_idx" ON "ServiceRequest"("requestType", "status");

-- CreateIndex
CREATE INDEX "ServiceRequestEvent_requestId_createdAt_idx" ON "ServiceRequestEvent"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceRequestEvent_actorUserId_createdAt_idx" ON "ServiceRequestEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedDocumentVersion_objectName_key" ON "GeneratedDocumentVersion"("objectName");

-- CreateIndex
CREATE INDEX "GeneratedDocumentVersion_templateId_idx" ON "GeneratedDocumentVersion"("templateId");

-- CreateIndex
CREATE INDEX "GeneratedDocumentVersion_publishedAt_revokedAt_idx" ON "GeneratedDocumentVersion"("publishedAt", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedDocumentVersion_requestId_versionNumber_key" ON "GeneratedDocumentVersion"("requestId", "versionNumber");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_resourceType_resourceId_idx" ON "Notification"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_actorUserId_operation_key_key" ON "IdempotencyRecord"("actorUserId", "operation", "key");

-- CreateIndex
CREATE UNIQUE INDEX "AuditExport_objectName_key" ON "AuditExport"("objectName");

-- CreateIndex
CREATE INDEX "AuditExport_requestedByUserId_createdAt_idx" ON "AuditExport"("requestedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLegalHold_resourceType_resourceId_idx" ON "AuditLegalHold"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLegalHold_workflowId_idx" ON "AuditLegalHold"("workflowId");

-- CreateIndex
CREATE INDEX "AuditLegalHold_subjectEmployeeId_idx" ON "AuditLegalHold"("subjectEmployeeId");

-- CreateIndex
CREATE INDEX "AuditLegalHold_releasedAt_endsAt_idx" ON "AuditLegalHold"("releasedAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_sequence_key" ON "AuditEvent"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_eventHash_key" ON "AuditEvent"("eventHash");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAtUtc_idx" ON "AuditEvent"("occurredAtUtc");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_occurredAtUtc_idx" ON "AuditEvent"("actorUserId", "occurredAtUtc");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectEmployeeId_occurredAtUtc_idx" ON "AuditEvent"("subjectEmployeeId", "occurredAtUtc");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectDepartmentId_occurredAtUtc_idx" ON "AuditEvent"("subjectDepartmentId", "occurredAtUtc");

-- CreateIndex
CREATE INDEX "AuditEvent_module_occurredAtUtc_idx" ON "AuditEvent"("module", "occurredAtUtc");

-- CreateIndex
CREATE INDEX "AuditEvent_resourceType_resourceId_idx" ON "AuditEvent"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_occurredAtUtc_idx" ON "AuditEvent"("action", "occurredAtUtc");

-- CreateIndex
CREATE INDEX "AuditEvent_outcome_occurredAtUtc_idx" ON "AuditEvent"("outcome", "occurredAtUtc");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

-- CreateIndex
CREATE INDEX "AuditEvent_workflowId_idx" ON "AuditEvent"("workflowId");

-- CreateIndex
CREATE INDEX "AuditEvent_payrollPeriod_occurredAtUtc_idx" ON "AuditEvent"("payrollPeriod", "occurredAtUtc");

-- CreateIndex
CREATE INDEX "AuditEvent_requestType_occurredAtUtc_idx" ON "AuditEvent"("requestType", "occurredAtUtc");

-- CreateIndex
CREATE INDEX "AuditEvent_isOverride_occurredAtUtc_idx" ON "AuditEvent"("isOverride", "occurredAtUtc");

-- CreateIndex
CREATE INDEX "AuditEvent_isSelfApproval_occurredAtUtc_idx" ON "AuditEvent"("isSelfApproval", "occurredAtUtc");

-- CreateIndex
CREATE INDEX "LeaveDecision_stepId_idx" ON "LeaveDecision"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveDecision_actorUserId_idempotencyKey_key" ON "LeaveDecision"("actorUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LeaveRequest_requesterUserId_idx" ON "LeaveRequest"("requesterUserId");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_createdAt_idx" ON "LeaveRequest"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_currentStage_idx" ON "LeaveRequest"("status", "currentStage");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_objectName_key" ON "Payroll"("objectName");

-- CreateIndex
CREATE INDEX "Payroll_employeeId_year_month_idx" ON "Payroll"("employeeId", "year", "month");

-- CreateIndex
CREATE INDEX "Payroll_runId_idx" ON "Payroll"("runId");

-- CreateIndex
CREATE INDEX "Payroll_revokedByUserId_idx" ON "Payroll"("revokedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_runId_employeeId_key" ON "Payroll"("runId", "employeeId");

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "RbacPermission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApprovalStep" ADD CONSTRAINT "LeaveApprovalStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApprovalStep" ADD CONSTRAINT "LeaveApprovalStep_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApprovalStep" ADD CONSTRAINT "LeaveApprovalStep_replacesStepId_fkey" FOREIGN KEY ("replacesStepId") REFERENCES "LeaveApprovalStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApprovalStepAssignee" ADD CONSTRAINT "LeaveApprovalStepAssignee_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "LeaveApprovalStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApprovalStepAssignee" ADD CONSTRAINT "LeaveApprovalStepAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApprovalStepAssignee" ADD CONSTRAINT "LeaveApprovalStepAssignee_delegatedFromUserId_fkey" FOREIGN KEY ("delegatedFromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveDecision" ADD CONSTRAINT "LeaveDecision_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "LeaveApprovalStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStagePolicy" ADD CONSTRAINT "WorkflowStagePolicy_primaryUserId_fkey" FOREIGN KEY ("primaryUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStagePolicyMember" ADD CONSTRAINT "WorkflowStagePolicyMember_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "WorkflowStagePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStagePolicyMember" ADD CONSTRAINT "WorkflowStagePolicyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDelegation" ADD CONSTRAINT "WorkflowDelegation_delegatorUserId_fkey" FOREIGN KEY ("delegatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDelegation" ADD CONSTRAINT "WorkflowDelegation_delegateUserId_fkey" FOREIGN KEY ("delegateUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDelegation" ADD CONSTRAINT "WorkflowDelegation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_subjectEmployeeId_fkey" FOREIGN KEY ("subjectEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequestEvent" ADD CONSTRAINT "ServiceRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequestEvent" ADD CONSTRAINT "ServiceRequestEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocumentVersion" ADD CONSTRAINT "GeneratedDocumentVersion_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocumentVersion" ADD CONSTRAINT "GeneratedDocumentVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocumentVersion" ADD CONSTRAINT "GeneratedDocumentVersion_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocumentVersion" ADD CONSTRAINT "GeneratedDocumentVersion_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocumentVersion" ADD CONSTRAINT "GeneratedDocumentVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocumentVersion" ADD CONSTRAINT "GeneratedDocumentVersion_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditExport" ADD CONSTRAINT "AuditExport_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLegalHold" ADD CONSTRAINT "AuditLegalHold_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit history is append-only. The guarded retention job is the only supported deletion path.
DROP TRIGGER IF EXISTS "AuditEvent_append_only" ON "AuditEvent";
DROP TRIGGER IF EXISTS "AuditChange_append_only" ON "AuditChange";
DROP FUNCTION IF EXISTS prevent_audit_mutation();

CREATE OR REPLACE FUNCTION "prevent_audit_history_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.audit_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Audit history is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_audit_history_mutation"();

CREATE TRIGGER "AuditChange_append_only"
BEFORE UPDATE OR DELETE ON "AuditChange"
FOR EACH ROW EXECUTE FUNCTION "prevent_audit_history_mutation"();
