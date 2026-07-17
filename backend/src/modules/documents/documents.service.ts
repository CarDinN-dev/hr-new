import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AccessScopeType, AuditAction, DocumentScanStatus, DocumentVisibility, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { QueryDocumentsDto } from './dto/query-documents.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { DocumentStorageService } from './document-storage.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { assertDocumentFile } from './document-file-validation';
import { DocumentMalwareScannerService } from './document-malware-scanner.service';

const documentInclude = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true } },
  uploadedBy: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } },
};

const documentSelect = {
  id: true,
  employeeId: true,
  documentType: true,
  fileName: true,
  fileUrl: true,
  documentNumber: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  uploadedById: true,
  expiryDate: true,
  visibility: true,
  scanStatus: true,
  scannedAt: true,
  scanResultCode: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  ...documentInclude,
} satisfies Prisma.EmployeeDocumentSelect;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentStorageService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly scanner: DocumentMalwareScannerService,
  ) {}

  async create(dto: CreateDocumentDto, user: RequestUser) {
    if (dto.employeeId) await this.ensureEmployee(dto.employeeId);
    const manageAll = this.authorization.permissionAllowedForScope(user, 'document.hr.manage', AccessScopeType.ALL_EMPLOYEES, dto.employeeId);
    this.assertCanManageEmployeeDocument(user, dto.employeeId, manageAll);
    const uploadedById = user.employeeId;
    if (!uploadedById) throw new NotFoundException('Uploader employee profile is required');
    if (dto.uploadedById && dto.uploadedById !== uploadedById) {
      throw new ForbiddenException('The document uploader must be the authenticated employee');
    }
    const visibility = this.documentVisibility(dto.employeeId, dto.visibility, manageAll);

    return this.documentTransaction(async (tx) => {
      const document = await tx.employeeDocument.create({
        data: { ...dto, visibility, uploadedById, scanStatus: DocumentScanStatus.CLEAN },
        select: documentSelect,
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'EmployeeDocument', entityId: document.id, summary: 'Document metadata created', subjectEmployeeId: dto.employeeId });
      return document;
    });
  }

  async upload(dto: UploadDocumentDto, file: Express.Multer.File | undefined, user: RequestUser) {
    if (!file?.buffer?.length) throw new BadRequestException('A document file is required');
    assertDocumentFile(file);
    if (dto.employeeId) await this.ensureEmployee(dto.employeeId);
    const manageAll = this.authorization.permissionAllowedForScope(user, 'document.hr.manage', AccessScopeType.ALL_EMPLOYEES, dto.employeeId);
    this.assertCanManageEmployeeDocument(user, dto.employeeId, manageAll);
    const uploadedById = user.employeeId;
    if (!uploadedById) throw new NotFoundException('Uploader employee profile is required');
    if (dto.uploadedById && dto.uploadedById !== uploadedById) {
      throw new ForbiddenException('The document uploader must be the authenticated employee');
    }
    const visibility = this.documentVisibility(dto.employeeId, dto.visibility, manageAll);

    const stored = dto.employeeId
      ? await this.storage.upload(dto.employeeId, file)
      : await this.storage.uploadPrivate(
        `organization/reports/${new Date().getUTCFullYear()}`,
        `${randomUUID()}-${file.originalname}`,
        file.mimetype,
        file.buffer,
        { ownerType: 'organization', originalName: file.originalname },
      );
    const id = randomUUID();
    try {
      const document = await this.documentTransaction(async (tx) => {
        const sequence = await tx.documentSequence.upsert({
          where: { key: 'employee_document' },
          create: { key: 'employee_document', value: 1 },
          update: { value: { increment: 1 } },
        });
        const document = await tx.employeeDocument.create({
          data: {
            id,
            employeeId: dto.employeeId,
            documentType: dto.documentType,
            fileName: file.originalname,
            fileUrl: `/api/v1/documents/${id}/content`,
            documentNumber: `DOC-${String(sequence.value).padStart(6, '0')}`,
            objectName: stored.objectName,
            objectGeneration: stored.generation,
            contentType: file.mimetype,
            sizeBytes: file.size,
            sha256: stored.sha256,
            uploadedById,
            expiryDate: dto.expiryDate,
            visibility,
            scanStatus: this.scanner.initialStatus(),
          },
          select: documentSelect,
        });
        await this.audit.record(tx, user, {
          action: AuditAction.CREATE,
          entityType: 'EmployeeDocument',
          entityId: id,
          summary: 'Employee document uploaded to private object storage',
          subjectEmployeeId: dto.employeeId,
        });
        return document;
      });
      this.scanner.wake();
      return document;
    } catch (error) {
      await this.storage.remove(stored.objectName, stored.generation).catch(() => undefined);
      throw error;
    }
  }

  async content(id: string, user: RequestUser) {
    const document = await this.prisma.employeeDocument.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, await this.visibilityWhere(user, true)] },
      select: {
        employeeId: true,
        fileName: true,
        contentType: true,
        objectName: true,
        objectGeneration: true,
        scanStatus: true,
      },
    });
    if (!document) throw new NotFoundException('Document not found');
    if (!document.objectName) throw new NotFoundException('Stored document content is not available');
    if (document.scanStatus === DocumentScanStatus.REJECTED) throw new NotFoundException('Document not found');
    if (document.scanStatus !== DocumentScanStatus.CLEAN) throw new ServiceUnavailableException('Document is unavailable until malware scanning succeeds');
    const buffer = await this.storage.download(document.objectName, document.objectGeneration);
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, entityType: 'EmployeeDocument', entityId: id, summary: 'Document content downloaded', subjectEmployeeId: document.employeeId ?? undefined });
    return { buffer, fileName: document.fileName, contentType: document.contentType ?? 'application/octet-stream' };
  }

  async list(query: QueryDocumentsDto, user: RequestUser) {
    const filters: Prisma.EmployeeDocumentWhereInput[] = [await this.visibilityWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.documentType) filters.push({ documentType: { contains: query.documentType, mode: 'insensitive' } });
    if (query.visibility) filters.push({ visibility: query.visibility });
    if (query.expiringBefore) filters.push({ expiryDate: { lte: query.expiringBefore } });

    const { page, limit, ...args } = listArgs(query, {
      searchFields: ['documentType', 'fileName'],
      allowedSortFields: ['createdAt', 'documentType', 'fileName', 'expiryDate', 'visibility'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      select: documentSelect,
    });

    const [data, total] = await Promise.all([
      this.prisma.employeeDocument.findMany(args),
      this.prisma.employeeDocument.count({ where: args.where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    const document = await this.prisma.employeeDocument.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, await this.visibilityWhere(user)] },
      select: documentSelect,
    });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  async update(id: string, dto: UpdateDocumentDto, user: RequestUser) {
    const document = await this.ensureDocument(id);
    const manageAll = this.authorization.permissionAllowedForScope(user, 'document.hr.manage', AccessScopeType.ALL_EMPLOYEES, document.employeeId);
    this.assertCanManageEmployeeDocument(user, document.employeeId, manageAll);
    if (!manageAll && dto.employeeId && dto.employeeId !== document.employeeId) {
      throw new ForbiddenException('Employees cannot reassign document ownership');
    }
    if (dto.employeeId && dto.employeeId !== document.employeeId) {
      await this.authorization.assertEmployeeScope(user, dto.employeeId, { all: 'document.hr.manage' });
    }
    if (dto.uploadedById && dto.uploadedById !== document.uploadedById) {
      throw new BadRequestException('The document uploader is immutable');
    }
    this.assertVisibility(dto.visibility, manageAll);
    if (dto.employeeId) await this.ensureEmployee(dto.employeeId);
    return this.documentTransaction(async (tx) => {
      const updated = await tx.employeeDocument.update({ where: { id }, data: { ...dto, uploadedById: undefined, version: { increment: 1 } }, select: documentSelect });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'EmployeeDocument', entityId: id, summary: 'Document metadata updated', subjectEmployeeId: dto.employeeId ?? document.employeeId ?? undefined });
      return updated;
    });
  }

  async remove(id: string, user: RequestUser) {
    const document = await this.ensureDocument(id);
    const manageAll = this.authorization.permissionAllowedForScope(user, 'document.hr.manage', AccessScopeType.ALL_EMPLOYEES, document.employeeId);
    this.assertCanManageEmployeeDocument(user, document.employeeId, manageAll);
    return this.documentTransaction(async (tx) => {
      const removed = await tx.employeeDocument.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } }, select: documentSelect });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'EmployeeDocument', entityId: id, summary: 'Document archived', subjectEmployeeId: document.employeeId ?? undefined });
      return removed;
    });
  }

  private async visibilityWhere(user: RequestUser, forDownload = false): Promise<Prisma.EmployeeDocumentWhereInput> {
    const scopes: Prisma.EmployeeDocumentWhereInput[] = [];
    const allPermissions = ['document.hr.read', 'document.read_all', ...(forDownload ? ['document.pdf.download_all'] : [])];
    for (const permission of allPermissions) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ employeeId: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ employeeId: { in: rule.includeIds } });
    }
    if (user.employeeId && this.authorization.permissionAllowedForScope(user, 'document.self.read', AccessScopeType.SELF, user.employeeId)) {
      scopes.push({ visibility: DocumentVisibility.PUBLIC });
      scopes.push({
        employeeId: user.employeeId,
        visibility: { in: [DocumentVisibility.EMPLOYEE_ONLY, DocumentVisibility.MANAGER_AND_HR, DocumentVisibility.PUBLIC] },
      });
    }
    if (user.employeeId && this.authorization.has(user, 'document.team.read')) {
      const directReports = await this.prisma.employee.findMany({ where: { managerId: user.employeeId, deletedAt: null }, select: { id: true } });
      const ids = directReports
        .map((employee) => employee.id)
        .filter((id) => this.authorization.permissionAllowedForScope(user, 'document.team.read', AccessScopeType.DIRECT_REPORTS, id));
      if (ids.length) scopes.push({ employeeId: { in: ids }, visibility: { in: [DocumentVisibility.MANAGER_AND_HR, DocumentVisibility.PUBLIC] } });
    }
    return scopes.length ? { OR: scopes } : { employeeId: '__no_document_scope__' };
  }

  private assertCanManageEmployeeDocument(user: RequestUser, employeeId: string | null | undefined, manageAll?: boolean) {
    if (manageAll ?? this.authorization.permissionAllowedForScope(user, 'document.hr.manage', AccessScopeType.ALL_EMPLOYEES, employeeId)) return;
    if (employeeId && employeeId === user.employeeId
      && this.authorization.permissionAllowedForScope(user, 'document.self.manage', AccessScopeType.SELF, employeeId)) return;
    throw new NotFoundException('Document not found');
  }

  private documentVisibility(employeeId: string | null | undefined, visibility: DocumentVisibility | undefined, manageAll: boolean) {
    if (!employeeId) {
      if (!manageAll) throw new NotFoundException('Document not found');
      return DocumentVisibility.HR_ONLY;
    }
    this.assertVisibility(visibility, manageAll);
    return visibility;
  }

  private assertVisibility(visibility: DocumentVisibility | undefined, manageAll: boolean) {
    if (!manageAll && visibility
      && visibility !== DocumentVisibility.EMPLOYEE_ONLY
      && visibility !== DocumentVisibility.MANAGER_AND_HR) {
      throw new ForbiddenException('Only HR can create public or HR-only documents');
    }
  }

  private async ensureDocument(id: string) {
    const document = await this.prisma.employeeDocument.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, employeeId: true, uploadedById: true },
    });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  private async documentTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
    throw new ConflictException('Document numbering changed in another request. Try again.');
  }
}
