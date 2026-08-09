CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Employee_hybrid_search_idx" ON "Employee" USING GIN
  ((lower(coalesce("employeeCode", '') || ' ' || coalesce("firstName", '') || ' ' || coalesce("lastName", '') || ' ' || coalesce("email", '') || ' ' || coalesce("phone", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Department_hybrid_search_idx" ON "Department" USING GIN
  ((lower(coalesce("code", '') || ' ' || coalesce("name", '') || ' ' || coalesce("description", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "JobPosition_hybrid_search_idx" ON "JobPosition" USING GIN
  ((lower(coalesce("code", '') || ' ' || coalesce("title", '') || ' ' || coalesce("description", '') || ' ' || coalesce("level", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Attendance_hybrid_search_idx" ON "Attendance" USING GIN
  ((lower(coalesce("notes", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "LeaveType_hybrid_search_idx" ON "LeaveType" USING GIN
  ((lower(coalesce("code", '') || ' ' || coalesce("name", '') || ' ' || coalesce("description", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "LeaveRequest_hybrid_search_idx" ON "LeaveRequest" USING GIN
  ((lower(coalesce("reason", '') || ' ' || coalesce("rejectionReason", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "EmployeeLoan_hybrid_search_idx" ON "EmployeeLoan" USING GIN
  ((lower(coalesce("type", '') || ' ' || coalesce("reference", '') || ' ' || coalesce("notes", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "PayrollRun_hybrid_search_idx" ON "PayrollRun" USING GIN
  ((lower(coalesce("purpose", '') || ' ' || coalesce("paymentBatchReference", '') || ' ' || coalesce("cancellationReason", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Payroll_hybrid_search_idx" ON "Payroll" USING GIN
  ((lower(coalesce("paymentReference", '') || ' ' || coalesce("paymentFailureReason", '') || ' ' || coalesce("revocationReason", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "RecruitmentJob_hybrid_search_idx" ON "RecruitmentJob" USING GIN
  ((lower(coalesce("title", '') || ' ' || coalesce("description", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "RecruitmentCandidate_hybrid_search_idx" ON "RecruitmentCandidate" USING GIN
  ((lower(coalesce("name", '') || ' ' || coalesce("email", '') || ' ' || coalesce("phone", '') || ' ' || coalesce("notes", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "EosRecord_hybrid_search_idx" ON "EosRecord" USING GIN
  ((lower(coalesce("reason", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "EmployeeDocument_hybrid_search_idx" ON "EmployeeDocument" USING GIN
  ((lower(coalesce("fileName", '') || ' ' || coalesce("documentType", '') || ' ' || coalesce("documentNumber", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ServiceRequest_hybrid_search_idx" ON "ServiceRequest" USING GIN
  ((lower(coalesce("requesterComment", '') || ' ' || coalesce("hrComment", '') || ' ' || coalesce("rejectionReason", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "AuditEvent_hybrid_search_idx" ON "AuditEvent" USING GIN
  ((lower(coalesce("actorNameSnapshot", '') || ' ' || coalesce("actorEmailSnapshot", '') || ' ' || coalesce("module", '') || ' ' || coalesce("resourceType", '') || ' ' || coalesce("resourceId", '') || ' ' || coalesce("reason", '') || ' ' || coalesce("permissionCode", '') || ' ' || coalesce("requestId", '') || ' ' || coalesce("correlationId", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_hybrid_search_idx" ON "User" USING GIN
  ((lower(coalesce("email", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "RbacRole_hybrid_search_idx" ON "RbacRole" USING GIN
  ((lower(coalesce("code", '') || ' ' || coalesce("displayName", '') || ' ' || coalesce("description", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "RbacPermission_hybrid_search_idx" ON "RbacPermission" USING GIN
  ((lower(coalesce("code", '') || ' ' || coalesce("displayName", '') || ' ' || coalesce("description", '') || ' ' || coalesce("category", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "AuthSession_hybrid_search_idx" ON "AuthSession" USING GIN
  ((lower(coalesce("provider", '') || ' ' || coalesce("userAgent", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "OrganizationSettings_hybrid_search_idx" ON "OrganizationSettings" USING GIN
  ((lower(coalesce("name", '') || ' ' || coalesce("legalName", '') || ' ' || coalesce("tagline", '') || ' ' || coalesce("address", '') || ' ' || coalesce("phone", '') || ' ' || coalesce("email", '') || ' ' || coalesce("website", '') || ' ' || coalesce("currency", ''))) gin_trgm_ops);

-- Full-text expression indexes complement trigram indexes for exact-word ranking.
CREATE INDEX IF NOT EXISTS "Employee_hybrid_search_fts_idx" ON "Employee" USING GIN
  (to_tsvector('simple', coalesce("employeeCode", '') || ' ' || coalesce("firstName", '') || ' ' || coalesce("lastName", '') || ' ' || coalesce("email", '') || ' ' || coalesce("phone", '')));
CREATE INDEX IF NOT EXISTS "Department_hybrid_search_fts_idx" ON "Department" USING GIN
  (to_tsvector('simple', coalesce("code", '') || ' ' || coalesce("name", '') || ' ' || coalesce("description", '')));
CREATE INDEX IF NOT EXISTS "JobPosition_hybrid_search_fts_idx" ON "JobPosition" USING GIN
  (to_tsvector('simple', coalesce("code", '') || ' ' || coalesce("title", '') || ' ' || coalesce("description", '') || ' ' || coalesce("level", '')));
CREATE INDEX IF NOT EXISTS "Attendance_hybrid_search_fts_idx" ON "Attendance" USING GIN
  (to_tsvector('simple', coalesce("notes", '')));
CREATE INDEX IF NOT EXISTS "LeaveType_hybrid_search_fts_idx" ON "LeaveType" USING GIN
  (to_tsvector('simple', coalesce("code", '') || ' ' || coalesce("name", '') || ' ' || coalesce("description", '')));
CREATE INDEX IF NOT EXISTS "LeaveRequest_hybrid_search_fts_idx" ON "LeaveRequest" USING GIN
  (to_tsvector('simple', coalesce("reason", '') || ' ' || coalesce("rejectionReason", '')));
CREATE INDEX IF NOT EXISTS "EmployeeLoan_hybrid_search_fts_idx" ON "EmployeeLoan" USING GIN
  (to_tsvector('simple', coalesce("type", '') || ' ' || coalesce("reference", '') || ' ' || coalesce("notes", '')));
CREATE INDEX IF NOT EXISTS "PayrollRun_hybrid_search_fts_idx" ON "PayrollRun" USING GIN
  (to_tsvector('simple', coalesce("purpose", '') || ' ' || coalesce("paymentBatchReference", '') || ' ' || coalesce("cancellationReason", '')));
CREATE INDEX IF NOT EXISTS "Payroll_hybrid_search_fts_idx" ON "Payroll" USING GIN
  (to_tsvector('simple', coalesce("paymentReference", '') || ' ' || coalesce("paymentFailureReason", '') || ' ' || coalesce("revocationReason", '')));
CREATE INDEX IF NOT EXISTS "RecruitmentJob_hybrid_search_fts_idx" ON "RecruitmentJob" USING GIN
  (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("description", '')));
CREATE INDEX IF NOT EXISTS "RecruitmentCandidate_hybrid_search_fts_idx" ON "RecruitmentCandidate" USING GIN
  (to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("email", '') || ' ' || coalesce("phone", '') || ' ' || coalesce("notes", '')));
CREATE INDEX IF NOT EXISTS "EosRecord_hybrid_search_fts_idx" ON "EosRecord" USING GIN
  (to_tsvector('simple', coalesce("reason", '')));
CREATE INDEX IF NOT EXISTS "EmployeeDocument_hybrid_search_fts_idx" ON "EmployeeDocument" USING GIN
  (to_tsvector('simple', coalesce("fileName", '') || ' ' || coalesce("documentType", '') || ' ' || coalesce("documentNumber", '')));
CREATE INDEX IF NOT EXISTS "ServiceRequest_hybrid_search_fts_idx" ON "ServiceRequest" USING GIN
  (to_tsvector('simple', coalesce("requesterComment", '') || ' ' || coalesce("hrComment", '') || ' ' || coalesce("rejectionReason", '')));
CREATE INDEX IF NOT EXISTS "AuditEvent_hybrid_search_fts_idx" ON "AuditEvent" USING GIN
  (to_tsvector('simple', coalesce("actorNameSnapshot", '') || ' ' || coalesce("actorEmailSnapshot", '') || ' ' || coalesce("module", '') || ' ' || coalesce("resourceType", '') || ' ' || coalesce("resourceId", '') || ' ' || coalesce("reason", '') || ' ' || coalesce("permissionCode", '') || ' ' || coalesce("requestId", '') || ' ' || coalesce("correlationId", '')));
CREATE INDEX IF NOT EXISTS "User_hybrid_search_fts_idx" ON "User" USING GIN
  (to_tsvector('simple', coalesce("email", '')));
CREATE INDEX IF NOT EXISTS "RbacRole_hybrid_search_fts_idx" ON "RbacRole" USING GIN
  (to_tsvector('simple', coalesce("code", '') || ' ' || coalesce("displayName", '') || ' ' || coalesce("description", '')));
CREATE INDEX IF NOT EXISTS "RbacPermission_hybrid_search_fts_idx" ON "RbacPermission" USING GIN
  (to_tsvector('simple', coalesce("code", '') || ' ' || coalesce("displayName", '') || ' ' || coalesce("description", '') || ' ' || coalesce("category", '')));
CREATE INDEX IF NOT EXISTS "AuthSession_hybrid_search_fts_idx" ON "AuthSession" USING GIN
  (to_tsvector('simple', coalesce("provider", '') || ' ' || coalesce("userAgent", '')));
CREATE INDEX IF NOT EXISTS "OrganizationSettings_hybrid_search_fts_idx" ON "OrganizationSettings" USING GIN
  (to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("legalName", '') || ' ' || coalesce("tagline", '') || ' ' || coalesce("address", '') || ' ' || coalesce("phone", '') || ' ' || coalesce("email", '') || ' ' || coalesce("website", '') || ' ' || coalesce("currency", '')));
CREATE INDEX IF NOT EXISTS "WorkflowDelegation_hybrid_search_idx" ON "WorkflowDelegation" USING GIN
  ((lower(coalesce("reason", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "WorkflowDelegation_hybrid_search_fts_idx" ON "WorkflowDelegation" USING GIN
  (to_tsvector('simple', coalesce("reason", '')));
