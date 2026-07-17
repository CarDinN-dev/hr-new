import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessScopeType, AuditAction, Prisma, ServiceRequestEventType, ServiceRequestStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { jsPDF } from 'jspdf';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { stripControlCharacters } from '../../common/utils/text.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { DocumentStorageService } from '../documents/document-storage.service';
import { CreateServiceRequestDto, QueryServiceRequestsDto, ServiceRequestOverrideDto, ServiceRequestReasonDto, ServiceRequestTransitionDto } from './dto/service-request.dto';

const requestInclude = {
  requester: { select: { id: true, email: true } },
  subject: { select: { id: true, userId: true, employeeCode: true, firstName: true, lastName: true, email: true, hireDate: true, employmentStatus: true, salary: true, department: { select: { name: true } }, position: { select: { title: true } } } },
  events: { orderBy: { createdAt: 'asc' as const }, include: { actor: { select: { id: true, email: true } } } },
  documents: { orderBy: { versionNumber: 'asc' as const }, include: { template: { select: { code: true, version: true, title: true } }, generatedBy: { select: { id: true, email: true } }, approvedBy: { select: { id: true, email: true } }, publishedBy: { select: { id: true, email: true } } } },
} satisfies Prisma.ServiceRequestInclude;
type ServiceRequestRecord = Prisma.ServiceRequestGetPayload<{ include: typeof requestInclude }>;

@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentStorageService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  create(dto: CreateServiceRequestDto, key: string | undefined, user: RequestUser) {
    return this.transaction(async (tx) => {
      const duplicate = await this.idempotent(tx, user, 'service-request.create', key, dto); if (duplicate) return duplicate;
      const subjectEmployeeId = dto.subjectEmployeeId ?? user.employeeId;
      if (!subjectEmployeeId) throw new NotFoundException('No employee profile is linked to this user');
      if (subjectEmployeeId === user.employeeId) {
        if (!this.authorization.permissionAllowedForScope(user, 'service_request.self.create', AccessScopeType.SELF, subjectEmployeeId)) throw new NotFoundException('Employee not found');
      } else if (!this.authorization.permissionAllowedForScope(user, 'service_request.hr.create_for_employee', AccessScopeType.ALL_EMPLOYEES, subjectEmployeeId)) throw new NotFoundException('Employee not found');
      const employee = await tx.employee.findFirst({ where: { id: subjectEmployeeId, deletedAt: null }, select: { id: true } });
      if (!employee) throw new NotFoundException('Employee not found');
      const request = await tx.serviceRequest.create({ data: { requestType: dto.requestType, requesterUserId: user.id, subjectEmployeeId, requesterComment: dto.requesterComment } });
      await tx.serviceRequestEvent.create({ data: { requestId: request.id, actorUserId: user.id, type: ServiceRequestEventType.SUBMITTED, toStatus: ServiceRequestStatus.SUBMITTED } });
      const reviewers = await tx.user.findMany({ where: { isActive: true, deletedAt: null, roles: { some: { revokedAt: null, role: { isActive: true, permissions: { some: { permission: { code: 'service_request.hr.generate', isDeprecated: false } } } } } } }, select: { id: true } });
      if (reviewers.length) await tx.notification.createMany({ data: reviewers.map(({ id }) => ({ userId: id, type: 'CERTIFICATE_REVIEW', title: 'Certificate request submitted', message: 'A certificate request is waiting for HR review.', resourceType: 'ServiceRequest', resourceId: request.id })) });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, resourceType: 'ServiceRequest', resourceId: request.id, workflowId: request.id, workflowStatus: request.status, requestType: request.requestType, summary: 'Certificate request submitted', subjectEmployeeId, after: request });
      await this.saveIdempotency(tx, user, 'service-request.create', key, dto, request.id);
      return this.present(await tx.serviceRequest.findUniqueOrThrow({ where: { id: request.id }, include: requestInclude }), user);
    });
  }

  async list(query: QueryServiceRequestsDto, user: RequestUser) {
    const filters: Prisma.ServiceRequestWhereInput[] = [this.accessWhere(user)];
    if (query.requestType) filters.push({ requestType: query.requestType }); if (query.status) filters.push({ status: query.status }); if (query.subjectEmployeeId) filters.push({ subjectEmployeeId: query.subjectEmployeeId });
    const { page, limit, ...args } = listArgs(query, { allowedSortFields: ['createdAt', 'updatedAt', 'status', 'requestType'], defaultSortBy: 'createdAt', where: { AND: filters }, include: requestInclude, softDelete: false });
    const [data, total] = await Promise.all([this.prisma.serviceRequest.findMany(args), this.prisma.serviceRequest.count({ where: args.where })]);
    return { data: (data as unknown as ServiceRequestRecord[]).map((request) => this.present(request, user)), meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    const request = await this.prisma.serviceRequest.findFirst({ where: { AND: [{ id }, this.accessWhere(user)] }, include: requestInclude });
    if (!request) throw new NotFoundException('Service request not found');
    return this.present(request, user);
  }

  review(id: string, dto: ServiceRequestTransitionDto, key: string | undefined, user: RequestUser) {
    this.assertWorkflowPermission(user, 'service_request.hr.generate', id);
    return this.transition(id, ServiceRequestStatus.SUBMITTED, ServiceRequestStatus.IN_HR_REVIEW, ServiceRequestEventType.REVIEW_STARTED, dto, key, user, 'service-request.review');
  }

  async generate(id: string, dto: ServiceRequestTransitionDto, key: string | undefined, user: RequestUser) {
    this.assertWorkflowPermission(user, 'service_request.hr.generate', id);
    this.validateKey(key);
    const existingKey = await this.prisma.idempotencyRecord.findUnique({ where: { actorUserId_operation_key: { actorUserId: user.id, operation: 'service-request.generate', key } } });
    if (existingKey) { if (existingKey.requestHash !== this.hash({ id, dto })) throw new ConflictException('Idempotency key was already used with a different request'); return this.findById(existingKey.resourceId, user); }
    const request = await this.prisma.serviceRequest.findUnique({ where: { id }, include: requestInclude });
    if (!request) throw new NotFoundException('Service request not found');
    this.assertVersion(request.version, dto.expectedVersion);
    if (!([ServiceRequestStatus.IN_HR_REVIEW, ServiceRequestStatus.GENERATED] as ServiceRequestStatus[]).includes(request.status)) throw new BadRequestException('Request must be in HR review or generated');
    const template = await this.prisma.documentTemplate.findFirst({ where: { code: request.requestType, isActive: true }, orderBy: { version: 'desc' } });
    if (!template) throw new BadRequestException('An active document template is not configured');
    const versionNumber = (request.documents.at(-1)?.versionNumber ?? 0) + 1;
    const pdf = this.certificatePdf(request, template.title, template.body);
    const fileName = `${request.requestType.toLowerCase()}-${request.subject.employeeCode}-v${versionNumber}.pdf`;
    const upload = await this.storage.uploadPrivate(`certificates/${request.subjectEmployeeId}/${request.id}`, fileName, 'application/pdf', pdf, { requestId: request.id, employeeId: request.subjectEmployeeId, version: String(versionNumber) });
    return this.transaction(async (tx) => {
      const duplicate = await this.idempotent(tx, user, 'service-request.generate', key, { id, dto }); if (duplicate) return duplicate;
      const current = await tx.serviceRequest.findUnique({ where: { id } }); if (!current) throw new NotFoundException('Service request not found');
      this.assertVersion(current.version, dto.expectedVersion);
      if (!([ServiceRequestStatus.IN_HR_REVIEW, ServiceRequestStatus.GENERATED] as ServiceRequestStatus[]).includes(current.status)) throw new ConflictException('Service request changed; refresh and retry');
      const document = await tx.generatedDocumentVersion.create({ data: { requestId: id, templateId: template.id, versionNumber, fileName, objectName: upload.objectName, objectGeneration: upload.generation, contentType: 'application/pdf', sizeBytes: upload.sizeBytes, sha256: upload.sha256, generatedByUserId: user.id } });
      await tx.serviceRequest.update({ where: { id }, data: { status: ServiceRequestStatus.GENERATED, hrComment: dto.reason, version: { increment: 1 } } });
      await tx.serviceRequestEvent.create({ data: { requestId: id, actorUserId: user.id, type: versionNumber > 1 ? ServiceRequestEventType.REGENERATED : ServiceRequestEventType.GENERATED, fromStatus: current.status, toStatus: ServiceRequestStatus.GENERATED, reason: dto.reason } });
      if (current.requesterUserId !== user.id) await tx.notification.create({ data: { userId: current.requesterUserId, type: 'CERTIFICATE_STATUS', title: 'Certificate request updated', message: 'Your certificate has been generated and is awaiting approval.', resourceType: 'ServiceRequest', resourceId: id } });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, resourceType: 'GeneratedDocumentVersion', resourceId: document.id, workflowId: id, workflowStatus: ServiceRequestStatus.GENERATED, requestType: current.requestType, summary: versionNumber > 1 ? 'Certificate regenerated' : 'Certificate generated', reason: dto.reason, subjectEmployeeId: current.subjectEmployeeId, metadata: { versionNumber, templateVersion: template.version, sha256: upload.sha256 } });
      await this.saveIdempotency(tx, user, 'service-request.generate', key, { id, dto }, id);
      return this.present(await tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), user);
    });
  }

  submitApproval(id: string, dto: ServiceRequestTransitionDto, key: string | undefined, user: RequestUser) {
    this.assertWorkflowPermission(user, 'service_request.hr.generate', id);
    return this.transition(id, ServiceRequestStatus.GENERATED, ServiceRequestStatus.PENDING_HR_APPROVAL, ServiceRequestEventType.SENT_FOR_APPROVAL, dto, key, user, 'service-request.submit-approval');
  }

  approve(id: string, dto: ServiceRequestTransitionDto, key: string | undefined, user: RequestUser) {
    this.assertWorkflowPermission(user, 'service_request.hr.approve', id);
    return this.transaction(async (tx) => {
      const duplicate = await this.idempotent(tx, user, 'service-request.approve', key, { id, dto }); if (duplicate) return duplicate;
      const request = await tx.serviceRequest.findUnique({ where: { id }, include: { documents: { where: { revokedAt: null }, orderBy: { versionNumber: 'desc' }, take: 1 } } });
      if (!request) throw new NotFoundException('Service request not found'); this.assertVersion(request.version, dto.expectedVersion);
      if (request.status !== ServiceRequestStatus.PENDING_HR_APPROVAL) throw new BadRequestException('Request is not waiting for HR approval');
      const document = request.documents[0]; if (!document) throw new ConflictException('Generated document is missing');
      if (document.generatedByUserId === user.id || request.subjectEmployeeId === user.employeeId) throw new ForbiddenException('Certificate maker or subject cannot approve the same certificate');
      await tx.generatedDocumentVersion.update({ where: { id: document.id }, data: { approvedByUserId: user.id, approvedAt: new Date() } });
      await this.updateStatus(tx, request, user, ServiceRequestStatus.APPROVED, ServiceRequestEventType.APPROVED, dto.reason);
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'ServiceRequest', resourceId: id, workflowId: id, workflowStatus: ServiceRequestStatus.APPROVED, requestType: request.requestType, summary: 'Certificate approved', reason: dto.reason, subjectEmployeeId: request.subjectEmployeeId, changes: [{ field: 'status', previousValue: request.status, nextValue: ServiceRequestStatus.APPROVED }] });
      await this.saveIdempotency(tx, user, 'service-request.approve', key, { id, dto }, id); return this.present(await tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), user);
    });
  }

  publish(id: string, dto: ServiceRequestTransitionDto, key: string | undefined, user: RequestUser) {
    this.assertWorkflowPermission(user, 'service_request.hr.publish', id);
    return this.transaction(async (tx) => {
      const duplicate = await this.idempotent(tx, user, 'service-request.publish', key, { id, dto }); if (duplicate) return duplicate;
      const request = await tx.serviceRequest.findUnique({ where: { id }, include: { documents: { where: { revokedAt: null }, orderBy: { versionNumber: 'desc' }, take: 1 } } });
      if (!request) throw new NotFoundException('Service request not found'); this.assertVersion(request.version, dto.expectedVersion);
      if (request.status !== ServiceRequestStatus.APPROVED) throw new BadRequestException('Only approved certificates can be published');
      const document = request.documents[0]; if (!document?.approvedAt) throw new ConflictException('Approved document version is missing');
      await tx.generatedDocumentVersion.update({ where: { id: document.id }, data: { publishedByUserId: user.id, publishedAt: new Date() } });
      await this.updateStatus(tx, request, user, ServiceRequestStatus.PUBLISHED, ServiceRequestEventType.PUBLISHED, dto.reason);
      const subject = await tx.employee.findUnique({ where: { id: request.subjectEmployeeId }, select: { userId: true } });
      if (subject?.userId && subject.userId !== request.requesterUserId) await tx.notification.create({ data: { userId: subject.userId, type: 'CERTIFICATE_PUBLISHED', title: 'Certificate available', message: 'A certificate for you is ready to download.', resourceType: 'ServiceRequest', resourceId: id } });
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'ServiceRequest', resourceId: id, workflowId: id, workflowStatus: ServiceRequestStatus.PUBLISHED, requestType: request.requestType, summary: 'Certificate published', reason: dto.reason, subjectEmployeeId: request.subjectEmployeeId, changes: [{ field: 'status', previousValue: request.status, nextValue: ServiceRequestStatus.PUBLISHED }] });
      await this.saveIdempotency(tx, user, 'service-request.publish', key, { id, dto }, id); return this.present(await tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), user);
    });
  }

  reject(id: string, dto: ServiceRequestReasonDto, key: string | undefined, user: RequestUser) {
    this.assertWorkflowPermission(user, 'service_request.hr.reject', id);
    return this.terminal(id, dto, key, user, ServiceRequestStatus.REJECTED, ServiceRequestEventType.REJECTED, 'service-request.reject');
  }

  cancel(id: string, dto: ServiceRequestReasonDto, key: string | undefined, user: RequestUser) {
    return this.transaction(async (tx) => {
      const duplicate = await this.idempotent(tx, user, 'service-request.cancel', key, { id, dto }); if (duplicate) return duplicate;
      const request = await tx.serviceRequest.findUnique({ where: { id } }); if (!request) throw new NotFoundException('Service request not found'); this.assertVersion(request.version, dto.expectedVersion);
      const own = request.subjectEmployeeId === user.employeeId || request.requesterUserId === user.id;
      const selfAllowed = own && request.subjectEmployeeId === user.employeeId
        && this.authorization.permissionAllowedForScope(user, 'service_request.self.cancel', AccessScopeType.SELF, request.subjectEmployeeId);
      const hrAllowed = this.authorization.permissionAllowedForScope(user, 'service_request.hr.reject', AccessScopeType.ASSIGNED_APPROVALS, request.id);
      if (!selfAllowed && !hrAllowed) throw new NotFoundException('Service request not found');
      if (([ServiceRequestStatus.PUBLISHED, ServiceRequestStatus.REJECTED, ServiceRequestStatus.CANCELLED, ServiceRequestStatus.REVOKED] as ServiceRequestStatus[]).includes(request.status)) throw new BadRequestException('This request cannot be cancelled');
      await this.updateStatus(tx, request, user, ServiceRequestStatus.CANCELLED, ServiceRequestEventType.CANCELLED, dto.reason);
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'ServiceRequest', resourceId: id, workflowId: id, workflowStatus: ServiceRequestStatus.CANCELLED, requestType: request.requestType, summary: 'Certificate request cancelled', reason: dto.reason, subjectEmployeeId: request.subjectEmployeeId });
      await this.saveIdempotency(tx, user, 'service-request.cancel', key, { id, dto }, id); return this.present(await tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), user);
    });
  }

  revoke(id: string, dto: ServiceRequestReasonDto, key: string | undefined, user: RequestUser) {
    this.assertWorkflowPermission(user, 'service_request.hr.revoke', id);
    return this.transaction(async (tx) => {
      const duplicate = await this.idempotent(tx, user, 'service-request.revoke', key, { id, dto }); if (duplicate) return duplicate;
      const request = await tx.serviceRequest.findUnique({ where: { id }, include: { documents: { where: { revokedAt: null, publishedAt: { not: null } } } } });
      if (!request) throw new NotFoundException('Service request not found'); this.assertVersion(request.version, dto.expectedVersion);
      if (request.status !== ServiceRequestStatus.PUBLISHED) throw new BadRequestException('Only published certificates can be revoked');
      await tx.generatedDocumentVersion.updateMany({ where: { requestId: id, revokedAt: null }, data: { revokedByUserId: user.id, revokedAt: new Date(), revocationReason: dto.reason } });
      await this.updateStatus(tx, request, user, ServiceRequestStatus.REVOKED, ServiceRequestEventType.REVOKED, dto.reason);
      await this.audit.record(tx, user, { action: AuditAction.REVOKE, resourceType: 'ServiceRequest', resourceId: id, workflowId: id, workflowStatus: ServiceRequestStatus.REVOKED, requestType: request.requestType, summary: 'Published certificate revoked', reason: dto.reason, subjectEmployeeId: request.subjectEmployeeId });
      await this.saveIdempotency(tx, user, 'service-request.revoke', key, { id, dto }, id); return this.present(await tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), user);
    });
  }

  override(id: string, dto: ServiceRequestOverrideDto, key: string | undefined, user: RequestUser) {
    if (!user.isSuperAdmin || !user.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Super Administrator override is required');
    this.authorization.requireRecentStepUp(user);
    const allowed: ServiceRequestStatus[] = [ServiceRequestStatus.APPROVED, ServiceRequestStatus.PUBLISHED, ServiceRequestStatus.REJECTED, ServiceRequestStatus.REVOKED];
    if (!allowed.includes(dto.targetStatus)) throw new BadRequestException('Invalid override target status');
    return this.transaction(async (tx) => {
      const duplicate = await this.idempotent(tx, user, 'service-request.override', key, { id, dto }); if (duplicate) return duplicate;
      const request = await tx.serviceRequest.findUnique({ where: { id }, include: { documents: { where: { revokedAt: null }, orderBy: { versionNumber: 'desc' }, take: 1 }, subject: { select: { userId: true } } } });
      if (!request) throw new NotFoundException('Service request not found');
      this.assertVersion(request.version, dto.expectedVersion);
      const document = request.documents[0];
      if (([ServiceRequestStatus.APPROVED, ServiceRequestStatus.PUBLISHED] as ServiceRequestStatus[]).includes(dto.targetStatus) && !document) throw new ConflictException('A generated document is required for this override');
      if (document && dto.targetStatus === ServiceRequestStatus.APPROVED) await tx.generatedDocumentVersion.update({ where: { id: document.id }, data: { approvedByUserId: user.id, approvedAt: new Date() } });
      if (document && dto.targetStatus === ServiceRequestStatus.PUBLISHED) await tx.generatedDocumentVersion.update({ where: { id: document.id }, data: { approvedByUserId: document.approvedByUserId ?? user.id, approvedAt: document.approvedAt ?? new Date(), publishedByUserId: user.id, publishedAt: new Date() } });
      if (dto.targetStatus === ServiceRequestStatus.REVOKED) await tx.generatedDocumentVersion.updateMany({ where: { requestId: id, revokedAt: null }, data: { revokedByUserId: user.id, revokedAt: new Date(), revocationReason: dto.reason } });
      await this.updateStatus(tx, request, user, dto.targetStatus, ServiceRequestEventType.OVERRIDDEN, dto.reason);
      const recipients = [...new Set([request.requesterUserId, request.subject.userId].filter((value): value is string => Boolean(value) && value !== user.id))];
      if (recipients.length) await tx.notification.createMany({ data: recipients.map((userId) => ({ userId, type: 'CERTIFICATE_OVERRIDE', title: 'Certificate workflow overridden', message: 'A Super Administrator changed a certificate workflow.', resourceType: 'ServiceRequest', resourceId: id })) });
      await this.audit.record(tx, user, { action: AuditAction.OVERRIDE, resourceType: 'ServiceRequest', resourceId: id, workflowId: id, workflowStatus: dto.targetStatus, requestType: request.requestType, summary: 'Certificate workflow overridden', reason: dto.reason, subjectEmployeeId: request.subjectEmployeeId, isOverride: true, before: { status: request.status, version: request.version }, after: { status: dto.targetStatus, version: request.version + 1 }, metadata: { skippedStatus: request.status, documentVersionId: document?.id } });
      await this.saveIdempotency(tx, user, 'service-request.override', key, { id, dto }, id);
      return this.present(await tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), user);
    });
  }

  async download(id: string, user: RequestUser) {
    const request = await this.prisma.serviceRequest.findUnique({ where: { id }, include: { documents: { where: { publishedAt: { not: null }, revokedAt: null }, orderBy: { versionNumber: 'desc' }, take: 1 }, subject: { select: { employeeCode: true } } } });
    if (!request || request.status !== ServiceRequestStatus.PUBLISHED) throw new NotFoundException('Published certificate not found');
    const self = request.subjectEmployeeId === user.employeeId && this.authorization.permissionAllowedForScope(user, 'service_request.self.download', AccessScopeType.SELF, request.subjectEmployeeId);
    if (!self && !this.authorization.permissionAllowedForScope(user, 'service_request.pdf.download_all', AccessScopeType.ALL_EMPLOYEES, request.subjectEmployeeId)) throw new NotFoundException('Published certificate not found');
    const document = request.documents[0]; if (!document) throw new NotFoundException('Published certificate not found');
    const buffer = await this.storage.download(document.objectName, document.objectGeneration);
    if (createHash('sha256').update(buffer).digest('hex') !== document.sha256) throw new ConflictException('Stored certificate integrity check failed');
    await this.audit.record(this.prisma, user, { action: AuditAction.DOWNLOAD, resourceType: 'GeneratedDocumentVersion', resourceId: document.id, workflowId: id, workflowStatus: request.status, requestType: request.requestType, summary: 'Published certificate downloaded', subjectEmployeeId: request.subjectEmployeeId });
    return { buffer, fileName: document.fileName };
  }

  private transition(id: string, from: ServiceRequestStatus, to: ServiceRequestStatus, eventType: ServiceRequestEventType, dto: ServiceRequestTransitionDto, key: string | undefined, user: RequestUser, operation: string) {
    return this.transaction(async (tx) => {
      const duplicate = await this.idempotent(tx, user, operation, key, { id, dto }); if (duplicate) return duplicate;
      const request = await tx.serviceRequest.findUnique({ where: { id } }); if (!request) throw new NotFoundException('Service request not found'); this.assertVersion(request.version, dto.expectedVersion);
      if (request.status !== from) throw new BadRequestException(`Service request must be ${from.toLowerCase().replaceAll('_', ' ')}`);
      await this.updateStatus(tx, request, user, to, eventType, dto.reason);
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'ServiceRequest', resourceId: id, workflowId: id, workflowStatus: to, requestType: request.requestType, summary: `Service request moved to ${to}`, reason: dto.reason, subjectEmployeeId: request.subjectEmployeeId, changes: [{ field: 'status', previousValue: from, nextValue: to }] });
      await this.saveIdempotency(tx, user, operation, key, { id, dto }, id); return this.present(await tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), user);
    });
  }

  private terminal(id: string, dto: ServiceRequestReasonDto, key: string | undefined, user: RequestUser, status: ServiceRequestStatus, event: ServiceRequestEventType, operation: string) {
    return this.transaction(async (tx) => {
      const duplicate = await this.idempotent(tx, user, operation, key, { id, dto }); if (duplicate) return duplicate;
      const request = await tx.serviceRequest.findUnique({ where: { id } }); if (!request) throw new NotFoundException('Service request not found'); this.assertVersion(request.version, dto.expectedVersion);
      if (([ServiceRequestStatus.PUBLISHED, ServiceRequestStatus.REJECTED, ServiceRequestStatus.CANCELLED, ServiceRequestStatus.REVOKED] as ServiceRequestStatus[]).includes(request.status)) throw new BadRequestException('Service request is already terminal');
      await this.updateStatus(tx, request, user, status, event, dto.reason);
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'ServiceRequest', resourceId: id, workflowId: id, workflowStatus: status, requestType: request.requestType, summary: `Service request ${status.toLowerCase()}`, reason: dto.reason, subjectEmployeeId: request.subjectEmployeeId });
      await this.saveIdempotency(tx, user, operation, key, { id, dto }, id); return this.present(await tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), user);
    });
  }

  private async updateStatus(tx: Prisma.TransactionClient, request: { id: string; status: ServiceRequestStatus; version: number; requesterUserId?: string }, user: RequestUser, status: ServiceRequestStatus, eventType: ServiceRequestEventType, reason?: string) {
    const updated = await tx.serviceRequest.updateMany({ where: { id: request.id, version: request.version, status: request.status }, data: { status, rejectionReason: status === ServiceRequestStatus.REJECTED ? reason : undefined, version: { increment: 1 } } });
    if (updated.count !== 1) throw new ConflictException('Service request changed; refresh and retry');
    await tx.serviceRequestEvent.create({ data: { requestId: request.id, actorUserId: user.id, type: eventType, fromStatus: request.status, toStatus: status, reason } });
    if (eventType !== ServiceRequestEventType.OVERRIDDEN && request.requesterUserId && request.requesterUserId !== user.id) await tx.notification.create({ data: { userId: request.requesterUserId, type: 'CERTIFICATE_STATUS', title: 'Certificate request updated', message: `Your certificate request is now ${status.toLowerCase().replaceAll('_', ' ')}.`, resourceType: 'ServiceRequest', resourceId: request.id } });
  }

  private accessWhere(user: RequestUser): Prisma.ServiceRequestWhereInput {
    const scopes: Prisma.ServiceRequestWhereInput[] = [];
    for (const permission of ['service_request.hr.read', 'service_request.read_all'] as const) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ subjectEmployeeId: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ subjectEmployeeId: { in: rule.includeIds } });
    }
    if (user.employeeId && this.authorization.permissionAllowedForScope(user, 'service_request.self.read', AccessScopeType.SELF, user.employeeId)) scopes.push({ subjectEmployeeId: user.employeeId });
    return scopes.length ? { OR: scopes } : { id: '__no_service_request_scope__' };
  }

  private assertWorkflowPermission(user: RequestUser, permission: string, requestId: string) {
    if (!this.authorization.permissionAllowedForScope(user, permission, AccessScopeType.ASSIGNED_APPROVALS, requestId)) throw new NotFoundException('Service request not found');
  }

  private present(request: ServiceRequestRecord, user: RequestUser) {
    const canReadCompensation = request.subjectEmployeeId === user.employeeId
      ? this.authorization.permissionAllowedForScope(user, 'employee.self.read_compensation', AccessScopeType.SELF, request.subjectEmployeeId)
      : this.authorization.permissionAllowedForScope(user, 'payroll.read_compensation', AccessScopeType.ALL_EMPLOYEES, request.subjectEmployeeId);
    const { salary, ...subject } = request.subject;
    return {
      ...request,
      subject: canReadCompensation ? { ...subject, salary } : subject,
      documents: request.documents.map(({ objectName: _objectName, objectGeneration: _objectGeneration, sha256: _sha256, ...document }) => document),
    };
  }

  private certificatePdf(request: Prisma.ServiceRequestGetPayload<{ include: typeof requestInclude }>, title: string, body: string) {
    const values: Record<string, string> = {
      employeeName: `${request.subject.firstName} ${request.subject.lastName}`, employeeCode: request.subject.employeeCode,
      department: request.subject.department?.name ?? 'N/A', position: request.subject.position?.title ?? 'N/A',
      hireDate: request.subject.hireDate.toISOString().slice(0, 10), salary: request.subject.salary.toFixed(2),
      issueDate: new Date().toISOString().slice(0, 10),
    };
    const replace = (text: string) => stripControlCharacters(text.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, key: string) => values[key] ?? ''));
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true }); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(replace(title).slice(0, 200), 297, 75, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); const lines = doc.splitTextToSize(replace(body), 490) as string[]; doc.text(lines, 52, 125, { lineHeightFactor: 1.55 });
    doc.setFontSize(8); doc.text(`Reference: ${request.id}`, 52, 790); return Buffer.from(doc.output('arraybuffer'));
  }

  private async idempotent(tx: Prisma.TransactionClient, user: RequestUser, operation: string, key: string | undefined, payload: unknown) {
    this.validateKey(key); const hash = this.hash(payload); const existing = await tx.idempotencyRecord.findUnique({ where: { actorUserId_operation_key: { actorUserId: user.id, operation, key: key! } } });
    if (!existing) return null; if (existing.requestHash !== hash) throw new ConflictException('Idempotency key was already used with a different request'); return this.present(await tx.serviceRequest.findUniqueOrThrow({ where: { id: existing.resourceId }, include: requestInclude }), user);
  }
  private saveIdempotency(tx: Prisma.TransactionClient, user: RequestUser, operation: string, key: string | undefined, payload: unknown, resourceId: string) { return tx.idempotencyRecord.create({ data: { actorUserId: user.id, operation, key: key!, requestHash: this.hash(payload), resourceType: 'ServiceRequest', resourceId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } }); }
  private validateKey(key: string | undefined): asserts key is string { if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new BadRequestException('A valid Idempotency-Key header is required'); }
  private hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private assertVersion(actual: number, expected: number) { if (actual !== expected) throw new ConflictException('Service request changed; refresh and retry'); }
  private async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) { for (let attempt = 0; attempt < 3; attempt += 1) { try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error; } } throw new ConflictException('Service request changed in another request. Try again.'); }
}
