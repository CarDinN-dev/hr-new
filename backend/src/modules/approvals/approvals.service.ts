import { Injectable } from '@nestjs/common';
import { AccessScopeType, LeaveApprovalStage, LeaveStepStatus, PayrollRunStatus, ServiceRequestStatus } from '@prisma/client';
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
    const [leave, certificates, payroll] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where: { steps: { some: { status: LeaveStepStatus.PENDING, assignees: { some: { userId: user.id, isActive: true, revokedAt: null } } } } }, include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } }, leaveType: { select: { name: true } }, steps: { where: { status: LeaveStepStatus.PENDING, assignees: { some: { userId: user.id, isActive: true, revokedAt: null } } }, select: { id: true, stage: true, workflowVersion: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }),
      this.authorization.has(user, 'service_request.hr.approve') ? this.prisma.serviceRequest.findMany({ where: { status: ServiceRequestStatus.PENDING_HR_APPROVAL }, include: { subject: { select: { userId: true, employeeCode: true, firstName: true, lastName: true } }, documents: { where: { revokedAt: null }, orderBy: { versionNumber: 'desc' }, take: 1, select: { generatedByUserId: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }) : [],
      this.authorization.has(user, 'payroll.approve') ? this.prisma.payrollRun.findMany({ where: { status: PayrollRunStatus.PENDING_APPROVAL, generatedByUserId: { not: user.id } }, include: { _count: { select: { payrolls: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }) : [],
    ]);
    return {
      leave: leave.filter((request) => request.steps.some((step) => step.workflowVersion === request.workflowVersion && step.stage === request.currentStage && this.authorization.permissionAllowedForScope(user, leavePermission[step.stage], AccessScopeType.ASSIGNED_APPROVALS, request.id))),
      certificates: certificates
        .filter((request) => request.subject.userId !== user.id && request.documents[0]?.generatedByUserId !== user.id && this.authorization.permissionAllowedForScope(user, 'service_request.hr.approve', AccessScopeType.ASSIGNED_APPROVALS, request.id))
        .map(({ documents: _documents, subject, ...request }) => ({ ...request, subject: { employeeCode: subject.employeeCode, firstName: subject.firstName, lastName: subject.lastName } })),
      payroll: payroll.filter((run) => this.authorization.permissionAllowedForScope(user, 'payroll.approve', AccessScopeType.ALL_SYSTEM, run.id)),
    };
  }
}
