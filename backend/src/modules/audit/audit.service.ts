import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessScopeType, AuditAction, AuditExportFormat, AuditOutcome, Prisma } from '@prisma/client';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { jsPDF } from 'jspdf';
import { RequestUser } from '../../common/types/request-user.type';
import { paginationMeta } from '../../common/utils/crud.util';
import { stripControlCharacters } from '../../common/utils/text.util';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentStorageService } from '../documents/document-storage.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { CreateAuditExportDto, CreateLegalHoldDto, QueryAuditDto, ReleaseLegalHoldDto, UpdateAuditPolicyDto } from './dto/audit.dto';

type AuditClient = Prisma.TransactionClient | PrismaService;

export type AuditEntry = {
  action: AuditAction;
  entityType?: string;
  resourceType?: string;
  entityId?: string;
  resourceId?: string;
  module?: string;
  summary: string;
  outcome?: AuditOutcome;
  reason?: string;
  permissionCode?: string;
  scopeType?: AccessScopeType;
  subjectEmployeeId?: string;
  subjectDepartmentId?: string;
  targetUserId?: string;
  workflowId?: string;
  workflowStage?: string;
  workflowStatus?: string;
  payrollPeriod?: string;
  requestType?: string;
  isOverride?: boolean;
  isSelfApproval?: boolean;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  changes?: Array<{ field: string; previousValue?: string | null; nextValue?: string | null }>;
};

@Injectable()
export class AuditService {
  private readonly hashKey: string;

  constructor(private readonly prisma: PrismaService, config: ConfigService, private readonly storage: DocumentStorageService, private readonly authorization: AuthorizationService) {
    this.hashKey = config.get<string>('AUDIT_HMAC_KEY') || config.getOrThrow<string>('JWT_SECRET');
  }

  record(client: AuditClient, user: RequestUser | null, entry: AuditEntry) {
    if (client === this.prisma) {
      return this.prisma.$transaction((tx) => this.create(tx, user, entry), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    }
    return this.create(client, user, entry);
  }

  private async create(client: Prisma.TransactionClient, user: RequestUser | null, entry: AuditEntry) {
    await client.auditChainState.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
    const [chain] = await client.$queryRaw<Array<{ lastSequence: bigint; lastHash: string | null }>>`
      SELECT "lastSequence", "lastHash" FROM "AuditChainState" WHERE "id" = 'default' FOR UPDATE
    `;
    const sequence = chain.lastSequence + 1n;
    const resourceType = entry.resourceType ?? entry.entityType ?? 'Unknown';
    const resourceId = entry.resourceId ?? entry.entityId;
    const before = this.redact(entry.before);
    const after = this.redact(entry.after);
    const metadata = this.redact(entry.metadata);
    const changedFields = entry.changes?.map((change) => change.field)
      ?? (before && after ? [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])) : []);
    const occurredAtUtc = new Date();
    const payload = {
      sequence: sequence.toString(), occurredAtUtc: occurredAtUtc.toISOString(), actorUserId: user?.id ?? null,
      actorEmployeeId: user?.employeeId ?? null, actorNameSnapshot: user?.displayName ?? null,
      actorEmailSnapshot: user?.email ?? null, actorRoleCodesSnapshot: user?.roles ?? [],
      action: entry.action, module: entry.module ?? resourceType.split(/[.:]/u)[0].toLowerCase(), resourceType, resourceId: resourceId ?? null,
      outcome: entry.outcome ?? AuditOutcome.SUCCESS, reason: entry.reason ?? entry.summary, requestId: user?.requestId ?? null,
      correlationId: user?.requestId ?? null, subjectEmployeeId: entry.subjectEmployeeId ?? null,
      subjectDepartmentId: entry.subjectDepartmentId ?? null, targetUserId: entry.targetUserId ?? null,
      permissionCode: entry.permissionCode ?? null, scopeType: entry.scopeType ?? null,
      workflowId: entry.workflowId ?? null, workflowStage: entry.workflowStage ?? null,
      workflowStatus: entry.workflowStatus ?? null, payrollPeriod: entry.payrollPeriod ?? null,
      requestType: entry.requestType ?? null, sessionId: user?.sessionId ?? null, ipHash: user?.ipHash ?? null,
      userAgent: user?.userAgent ?? null, route: user?.route ?? null, httpMethod: user?.httpMethod ?? null,
      isOverride: entry.isOverride ?? false, isSelfApproval: entry.isSelfApproval ?? false,
      changedFields, before: before ?? null, after: after ?? null, metadata: metadata ?? null,
      previousEventHash: chain.lastHash,
    };
    const eventHash = createHmac('sha256', this.hashKey).update(this.canonical(payload)).digest('hex');
    const event = await client.auditEvent.create({
      data: {
        sequence,
        occurredAtUtc,
        actorUserId: user?.id,
        actorEmployeeId: user?.employeeId ?? undefined,
        actorNameSnapshot: user?.displayName,
        actorEmailSnapshot: user?.email,
        actorRoleCodesSnapshot: user?.roles ?? [],
        action: entry.action,
        module: payload.module,
        resourceType,
        resourceId,
        subjectEmployeeId: entry.subjectEmployeeId,
        subjectDepartmentId: entry.subjectDepartmentId,
        targetUserId: entry.targetUserId,
        outcome: entry.outcome ?? AuditOutcome.SUCCESS,
        reason: entry.reason ?? entry.summary,
        permissionCode: entry.permissionCode,
        scopeType: entry.scopeType,
        beforeJson: before as Prisma.InputJsonValue | undefined,
        afterJson: after as Prisma.InputJsonValue | undefined,
        changedFields,
        requestId: user?.requestId,
        correlationId: user?.requestId,
        workflowId: entry.workflowId,
        workflowStage: entry.workflowStage,
        workflowStatus: entry.workflowStatus,
        payrollPeriod: entry.payrollPeriod,
        requestType: entry.requestType,
        sessionId: user?.sessionId,
        ipHash: user?.ipHash,
        userAgent: user?.userAgent,
        route: user?.route,
        httpMethod: user?.httpMethod,
        isOverride: entry.isOverride ?? false,
        isSelfApproval: entry.isSelfApproval ?? false,
        metadataJson: metadata as Prisma.InputJsonValue | undefined,
        previousEventHash: chain.lastHash,
        eventHash,
        changes: entry.changes?.length ? { create: entry.changes.map((change) => ({
          field: change.field,
          previousValue: this.redactText(change.field, change.previousValue),
          nextValue: this.redactText(change.field, change.nextValue),
        })) } : undefined,
      },
    });
    await client.auditChainState.update({ where: { id: 'default' }, data: { lastSequence: sequence, lastHash: eventHash } });
    return event;
  }

  async list(query: QueryAuditDto, user: RequestUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.scopedWhere(this.exportWhere(query), user, 'audit.read');
    const allowedSort = new Set(['occurredAtUtc', 'action', 'outcome', 'module', 'resourceType', 'sequence']);
    const sortBy = query.sortBy && allowedSort.has(query.sortBy) ? query.sortBy : 'occurredAtUtc';
    const [data, total] = await Promise.all([
      this.prisma.auditEvent.findMany({ where, include: { actor: { select: { id: true, email: true } }, changes: true }, orderBy: { [sortBy]: query.sortOrder ?? 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return { data: data.map((event) => ({ ...event, sequence: event.sequence.toString() })), meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    this.assertAuditScope(user, 'audit.read', id);
    const event = await this.prisma.auditEvent.findUnique({ where: { id }, include: { actor: { select: { id: true, email: true } }, changes: true } });
    if (!event) throw new NotFoundException('Audit event not found');
    return { ...event, sequence: event.sequence.toString() };
  }

  async verifyChain(user: RequestUser) {
    this.assertAuditScope(user, 'audit.read');
    const events = await this.prisma.auditEvent.findMany({ orderBy: { sequence: 'asc' } });
    const state = await this.prisma.auditChainState.findUnique({ where: { id: 'default' } });
    let previous: string | null = state?.prunedThroughHash ?? null;
    let expectedSequence = (state?.prunedThroughSequence ?? 0n) + 1n;
    for (const event of events) {
      if (event.sequence !== expectedSequence) return { valid: false, brokenAtSequence: event.sequence.toString(), reason: 'sequence gap' };
      if (event.previousEventHash !== previous) return { valid: false, brokenAtSequence: event.sequence.toString(), reason: 'previous hash mismatch' };
      const payload: Record<string, unknown> = {
        sequence: event.sequence.toString(), occurredAtUtc: event.occurredAtUtc.toISOString(), actorUserId: event.actorUserId,
        actorEmployeeId: event.actorEmployeeId, actorNameSnapshot: event.actorNameSnapshot,
        actorEmailSnapshot: event.actorEmailSnapshot, actorRoleCodesSnapshot: event.actorRoleCodesSnapshot,
        action: event.action, module: event.module, resourceType: event.resourceType, resourceId: event.resourceId,
        outcome: event.outcome, reason: event.reason, requestId: event.requestId, correlationId: event.correlationId,
        subjectEmployeeId: event.subjectEmployeeId, subjectDepartmentId: event.subjectDepartmentId,
        targetUserId: event.targetUserId, permissionCode: event.permissionCode, scopeType: event.scopeType,
        workflowId: event.workflowId, workflowStage: event.workflowStage, workflowStatus: event.workflowStatus,
        payrollPeriod: event.payrollPeriod, requestType: event.requestType, sessionId: event.sessionId,
        ipHash: event.ipHash, userAgent: event.userAgent, route: event.route, httpMethod: event.httpMethod,
        isOverride: event.isOverride, isSelfApproval: event.isSelfApproval,
        changedFields: event.changedFields, before: event.beforeJson, after: event.afterJson,
        metadata: event.metadataJson, previousEventHash: event.previousEventHash,
      };
      const expected: string = createHmac('sha256', this.hashKey).update(this.canonical(payload)).digest('hex');
      if (expected !== event.eventHash) return { valid: false, brokenAtSequence: event.sequence.toString(), reason: 'event hash mismatch' };
      previous = event.eventHash;
      expectedSequence += 1n;
    }
    if (state && (state.lastSequence !== expectedSequence - 1n || state.lastHash !== previous)) return { valid: false, reason: 'chain state mismatch' };
    return { valid: true, eventCount: events.length, lastHash: previous };
  }

  async createExport(dto: CreateAuditExportDto, user: RequestUser) {
    const where = this.scopedWhere(this.exportWhere(dto), user, 'audit.export');
    const events = await this.prisma.auditEvent.findMany({ where, orderBy: { occurredAtUtc: 'asc' }, take: 10_001 });
    if (events.length > 10_000) throw new BadRequestException('Audit export is limited to 10,000 records');
    const { buffer, contentType, extension } = dto.format === AuditExportFormat.PDF ? this.auditPdf(events) : this.auditCsv(events);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const exportId = randomUUID();
    const fileName = `audit-export-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
    const uploaded = await this.storage.uploadPrivate(`audit-exports/${new Date().getUTCFullYear()}`, `${exportId}-${fileName}`, contentType, buffer, { exportId, requestedBy: user.id });
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.auditExport.create({ data: { id: exportId, requestedByUserId: user.id, format: dto.format, filtersJson: this.exportFilterJson(dto), recordCount: events.length, fileName, objectName: uploaded.objectName, objectGeneration: uploaded.generation, contentType, sizeBytes: buffer.length, sha256 } });
      await this.record(tx, user, { action: AuditAction.EXPORT, resourceType: 'AuditExport', resourceId: record.id, summary: 'Audit export created', reason: dto.exportReason, metadata: { format: dto.format, recordCount: events.length, filters: this.exportFilterJson(dto), sha256 } });
      return {
        id: record.id, format: record.format, recordCount: record.recordCount, fileName: record.fileName,
        contentType: record.contentType, sizeBytes: record.sizeBytes, sha256: record.sha256, createdAt: record.createdAt,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async downloadExport(id: string, user: RequestUser) {
    this.assertAuditScope(user, 'audit.export', id);
    const record = await this.prisma.auditExport.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Audit export not found');
    const buffer = await this.storage.download(record.objectName, record.objectGeneration);
    if (createHash('sha256').update(buffer).digest('hex') !== record.sha256) throw new ConflictException('Stored audit export integrity check failed');
    await this.record(this.prisma, user, { action: AuditAction.DOWNLOAD, resourceType: 'AuditExport', resourceId: id, summary: 'Audit export downloaded' });
    return { buffer, fileName: record.fileName, contentType: record.contentType };
  }

  policy(user: RequestUser) {
    this.assertAuditScope(user, 'audit.configure', 'default');
    return this.prisma.auditRetentionPolicy.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
  }

  updatePolicy(dto: UpdateAuditPolicyDto, user: RequestUser) {
    this.assertAuditScope(user, 'audit.configure', 'default');
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.auditRetentionPolicy.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
      if (policy.version !== dto.expectedVersion) throw new ConflictException('Audit policy changed; refresh and retry');
      const updated = await tx.auditRetentionPolicy.update({ where: { id: 'default' }, data: { enabled: dto.enabled, retentionDays: dto.retentionDays, updatedByUserId: user.id, version: { increment: 1 } } });
      await this.record(tx, user, { action: AuditAction.UPDATE, resourceType: 'AuditRetentionPolicy', resourceId: 'default', summary: 'Audit retention policy updated', reason: dto.reason, before: policy, after: updated });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  listLegalHolds(user: RequestUser) {
    const rule = this.authorization.scopeRule(user, 'audit.configure', AccessScopeType.ALL_SYSTEM);
    return this.prisma.auditLegalHold.findMany({ where: { id: rule.unrestricted ? (rule.excludeIds.length ? { notIn: rule.excludeIds } : undefined) : { in: rule.includeIds, notIn: rule.excludeIds } }, include: { createdBy: { select: { id: true, email: true } } }, orderBy: { createdAt: 'desc' } });
  }

  createLegalHold(dto: CreateLegalHoldDto, user: RequestUser) {
    this.assertAuditScope(user, 'audit.configure');
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.auditLegalHold.create({ data: { ...dto, createdByUserId: user.id } });
      await this.record(tx, user, { action: AuditAction.CREATE, resourceType: 'AuditLegalHold', resourceId: hold.id, summary: 'Audit legal hold created', reason: dto.reason, after: hold });
      return hold;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  releaseLegalHold(id: string, dto: ReleaseLegalHoldDto, user: RequestUser) {
    this.assertAuditScope(user, 'audit.configure', id);
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.auditLegalHold.findUnique({ where: { id } });
      if (!hold || hold.releasedAt) throw new NotFoundException('Active legal hold not found');
      const updated = await tx.auditLegalHold.update({ where: { id }, data: { releasedAt: new Date() } });
      await this.record(tx, user, { action: AuditAction.REVOKE, resourceType: 'AuditLegalHold', resourceId: id, summary: 'Audit legal hold released', reason: dto.reason, before: hold, after: updated });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private exportWhere(query: QueryAuditDto): Prisma.AuditEventWhereInput {
    if (query.dateFrom && query.dateTo && query.dateTo < query.dateFrom) throw new BadRequestException('dateTo must be on or after dateFrom');
    return {
      actorUserId: query.actorUserId, actorEmailSnapshot: query.actorEmail ? { contains: query.actorEmail, mode: 'insensitive' } : undefined,
      actorRoleCodesSnapshot: query.actorRoleCode ? { has: query.actorRoleCode } : undefined,
      action: query.action, outcome: query.outcome, module: query.module,
      resourceType: query.resourceType, resourceId: query.resourceId, subjectEmployeeId: query.subjectEmployeeId,
      subjectDepartmentId: query.subjectDepartmentId, workflowId: query.workflowId,
      workflowStage: query.workflowStage, workflowStatus: query.workflowStatus,
      payrollPeriod: query.payrollPeriod, requestType: query.requestType,
      permissionCode: query.permissionCode, scopeType: query.scopeType,
      requestId: query.requestId, correlationId: query.correlationId, sessionId: query.sessionId,
      ipHash: query.ipHash, changedFields: query.changedField ? { has: query.changedField } : undefined,
      isOverride: query.isOverride, isSelfApproval: query.isSelfApproval,
      occurredAtUtc: query.dateFrom || query.dateTo ? { gte: query.dateFrom, lte: query.dateTo } : undefined,
      OR: query.search ? [
        { resourceType: { contains: query.search, mode: 'insensitive' } },
        { resourceId: { contains: query.search, mode: 'insensitive' } },
        { reason: { contains: query.search, mode: 'insensitive' } },
        { actorEmailSnapshot: { contains: query.search, mode: 'insensitive' } },
        { permissionCode: { contains: query.search, mode: 'insensitive' } },
      ] : undefined,
    };
  }

  private scopedWhere(where: Prisma.AuditEventWhereInput, user: RequestUser, permission: string): Prisma.AuditEventWhereInput {
    const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_SYSTEM);
    return {
      AND: [
        where,
        { id: rule.unrestricted ? (rule.excludeIds.length ? { notIn: rule.excludeIds } : undefined) : { in: rule.includeIds, notIn: rule.excludeIds } },
      ],
    };
  }

  private assertAuditScope(user: RequestUser, permission: string, resourceId?: string) {
    if (this.authorization.permissionAllowedForScope(user, permission, AccessScopeType.ALL_SYSTEM, resourceId)) return;
    void this.record(this.prisma, user, {
      action: AuditAction.ACCESS,
      outcome: AuditOutcome.DENIED,
      resourceType: 'AuthorizationDenial',
      resourceId,
      permissionCode: permission,
      scopeType: AccessScopeType.ALL_SYSTEM,
      summary: 'Audit record access denied by scope policy',
      reason: 'Audit record access denied by scope policy',
    }).catch(() => undefined);
    if (resourceId) throw new NotFoundException('Record not found');
    throw new ForbiddenException('Insufficient permission');
  }

  private exportFilterJson(query: QueryAuditDto): Prisma.InputJsonObject {
    return Object.fromEntries(Object.entries(query).filter(([key, value]) => value !== undefined && !['page', 'limit', 'sortBy', 'sortOrder', 'format', 'exportReason'].includes(key)).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])) as Prisma.InputJsonObject;
  }

  private auditCsv(events: Array<Prisma.AuditEventGetPayload<Record<string, never>>>) {
    const q = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [['Sequence', 'Occurred At UTC', 'Actor', 'Action', 'Outcome', 'Module', 'Resource Type', 'Resource ID', 'Reason'], ...events.map((event) => [event.sequence.toString(), event.occurredAtUtc.toISOString(), event.actorEmailSnapshot ?? '', event.action, event.outcome, event.module, event.resourceType, event.resourceId ?? '', event.reason ?? ''])];
    return { buffer: Buffer.from(`\uFEFF${rows.map((row) => row.map(q).join(',')).join('\r\n')}`, 'utf8'), contentType: 'text/csv; charset=utf-8', extension: 'csv' };
  }

  private auditPdf(events: Array<Prisma.AuditEventGetPayload<Record<string, never>>>) {
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true }); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Audit Export', 40, 45); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    let y = 70; for (const event of events) { const line = `${event.sequence} | ${event.occurredAtUtc.toISOString()} | ${event.action} | ${event.outcome} | ${event.resourceType} | ${stripControlCharacters(event.reason ?? '').slice(0, 100)}`; for (const part of doc.splitTextToSize(line, 515) as string[]) { if (y > 800) { doc.addPage(); y = 40; } doc.text(part, 40, y); y += 10; } y += 3; }
    return { buffer: Buffer.from(doc.output('arraybuffer')), contentType: 'application/pdf', extension: 'pdf' };
  }

  private redact(value: unknown): Record<string, unknown> | undefined {
    const normalized = this.normalize(value);
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return undefined;
    return Object.fromEntries(Object.entries(normalized).map(([key, item]) => [key, this.sensitive(key) ? '[REDACTED]' : this.redactValue(item)]));
  }

  private redactValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.redactValue(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.sensitive(key) ? '[REDACTED]' : this.redactValue(item)]));
    return value;
  }

  private redactText(field: string, value?: string | null) {
    return this.sensitive(field) && value != null ? '[REDACTED]' : value;
  }

  private sensitive(field: string) {
    return /(password|token|secret|private.?key|iban|account.?number|bank.?account|credential|salary|compensation|gross.?pay|net.?pay)/iu.test(field);
  }

  private normalize(value: unknown): unknown {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item));
  }

  private canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonical(item)).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${this.canonical(item)}`).join(',')}}`;
    return JSON.stringify(value);
  }
}
