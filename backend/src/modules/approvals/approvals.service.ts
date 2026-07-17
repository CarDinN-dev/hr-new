import { Injectable } from '@nestjs/common';
import { AccessScopeType, LeaveApprovalStage, PayrollRunStatus, Prisma, ServiceRequestStatus } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthorizationService } from '../authorization/authorization.service';

const leavePermission: Record<LeaveApprovalStage, string> = {
  LINE_MANAGER: 'leave.team.approve_line_manager', MANAGER: 'leave.management.approve_manager', HR: 'leave.hr.approve', CPO: 'leave.executive.approve_cpo', COO: 'leave.executive.approve_coo',
};

@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService) {}
  async inbox(user: RequestUser) {
    const leaveAssignments = await this.prisma.$queryRaw<Array<{ id: string; stage: LeaveApprovalStage }>>(Prisma.sql`
      SELECT request."id", step."stage"
      FROM "LeaveRequest" AS request
      INNER JOIN "LeaveApprovalStep" AS step
        ON step."requestId" = request."id"
       AND step."workflowVersion" = request."workflowVersion"
       AND step."stage" = request."currentStage"
       AND step."status" = 'PENDING'::"LeaveStepStatus"
      INNER JOIN "LeaveApprovalStepAssignee" AS assignee
        ON assignee."stepId" = step."id"
       AND assignee."userId" = ${user.id}
       AND assignee."isActive" = TRUE
       AND assignee."revokedAt" IS NULL
      WHERE request."deletedAt" IS NULL
        AND request."requesterUserId" <> ${user.id}
        ${user.employeeId ? Prisma.sql`AND request."employeeId" <> ${user.employeeId}` : Prisma.empty}
    `);
    const leaveIds = leaveAssignments
      .filter((assignment) => this.authorization.permissionAllowedForScope(user, leavePermission[assignment.stage], AccessScopeType.ASSIGNED_APPROVALS, assignment.id))
      .map((assignment) => assignment.id);
    const certificateScope = this.idScope(user, 'service_request.hr.approve', AccessScopeType.ASSIGNED_APPROVALS);
    const payrollScope = this.idScope(user, 'payroll.approve', AccessScopeType.ALL_SYSTEM);
    const [leave, certificates, payroll] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where: { id: { in: leaveIds } }, include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } }, leaveType: { select: { name: true } }, steps: { where: { assignees: { some: { userId: user.id, isActive: true, revokedAt: null } } }, select: { id: true, stage: true, workflowVersion: true } } }, orderBy: { createdAt: 'asc' } }),
      this.authorization.has(user, 'service_request.hr.approve') ? this.prisma.serviceRequest.findMany({ where: { status: ServiceRequestStatus.PENDING_HR_APPROVAL, ...certificateScope, subject: { userId: { not: user.id } }, documents: { some: { revokedAt: null }, none: { revokedAt: null, generatedByUserId: user.id } } }, include: { subject: { select: { userId: true, employeeCode: true, firstName: true, lastName: true } }, documents: { where: { revokedAt: null }, orderBy: { versionNumber: 'desc' }, take: 1, select: { generatedByUserId: true } } }, orderBy: { createdAt: 'asc' } }) : [],
      this.authorization.has(user, 'payroll.approve') ? this.prisma.payrollRun.findMany({ where: { status: PayrollRunStatus.PENDING_APPROVAL, generatedByUserId: { not: user.id }, ...payrollScope }, include: { _count: { select: { payrolls: true } } }, orderBy: { createdAt: 'asc' } }) : [],
    ]);
    return {
      leave,
      certificates: certificates
        .map(({ documents: _documents, subject, ...request }) => ({ ...request, subject: { employeeCode: subject.employeeCode, firstName: subject.firstName, lastName: subject.lastName } })),
      payroll,
    };
  }

  private idScope(user: RequestUser, permission: string, scopeType: AccessScopeType) {
    const rule = this.authorization.scopeRule(user, permission, scopeType);
    return rule.unrestricted
      ? (rule.excludeIds.length ? { id: { notIn: rule.excludeIds } } : {})
      : { id: { in: rule.includeIds, notIn: rule.excludeIds } };
  }
}
