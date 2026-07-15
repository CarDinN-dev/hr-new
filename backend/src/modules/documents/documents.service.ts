import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, DocumentVisibility, Prisma, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hasHrAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { QueryDocumentsDto } from './dto/query-documents.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { DocumentStorageService } from './document-storage.service';
import { AuditService } from '../audit/audit.service';

const documentInclude = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true } },
  uploadedBy: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } },
};

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentStorageService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateDocumentDto, user: RequestUser) {
    await this.ensureEmployee(dto.employeeId);
    const uploadedById = hasHrAccess(user.role) ? dto.uploadedById ?? user.employeeId : user.employeeId;
    if (!uploadedById) throw new NotFoundException('Uploader employee profile is required');

    if (!hasHrAccess(user.role) && dto.employeeId !== user.employeeId) {
      throw new ForbiddenException('Employees can only upload documents for themselves');
    }
    if (!hasHrAccess(user.role) && dto.uploadedById && dto.uploadedById !== uploadedById) {
      throw new ForbiddenException('Employees cannot upload documents as another employee');
    }
    if (!hasHrAccess(user.role) && dto.visibility === DocumentVisibility.PUBLIC) {
      throw new ForbiddenException('Only HR can publish documents to all employees');
    }
    await this.ensureEmployee(uploadedById);

    return this.documentTransaction(async (tx) => {
      const document = await tx.employeeDocument.create({
        data: { ...dto, uploadedById },
        include: documentInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'EmployeeDocument', entityId: document.id, summary: 'Document metadata created' });
      return document;
    });
  }

  async upload(dto: UploadDocumentDto, file: Express.Multer.File | undefined, user: RequestUser) {
    if (!file?.buffer?.length) throw new BadRequestException('A document file is required');
    await this.ensureEmployee(dto.employeeId);
    const uploadedById = hasHrAccess(user.role) ? dto.uploadedById ?? user.employeeId : user.employeeId;
    if (!uploadedById) throw new NotFoundException('Uploader employee profile is required');
    if (!hasHrAccess(user.role) && dto.employeeId !== user.employeeId) {
      throw new ForbiddenException('Employees can only upload documents for themselves');
    }
    if (!hasHrAccess(user.role) && dto.visibility === DocumentVisibility.PUBLIC) {
      throw new ForbiddenException('Only HR can publish documents to all employees');
    }
    await this.ensureEmployee(uploadedById);

    const stored = await this.storage.upload(dto.employeeId, file);
    const id = randomUUID();
    try {
      return await this.documentTransaction(async (tx) => {
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
            visibility: dto.visibility,
          },
          include: documentInclude,
        });
        await this.audit.record(tx, user, {
          action: AuditAction.CREATE,
          entityType: 'EmployeeDocument',
          entityId: id,
          summary: 'Employee document uploaded to private object storage',
        });
        return document;
      });
    } catch (error) {
      await this.storage.remove(stored.objectName, stored.generation).catch(() => undefined);
      throw error;
    }
  }

  async content(id: string, user: RequestUser) {
    const document = await this.findById(id, user);
    if (!document.objectName) throw new NotFoundException('Stored document content is not available');
    const buffer = await this.storage.download(document.objectName, document.objectGeneration);
    return { buffer, fileName: document.fileName, contentType: document.contentType ?? 'application/octet-stream' };
  }

  async list(query: QueryDocumentsDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [this.visibilityWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.documentType) filters.push({ documentType: { contains: query.documentType, mode: 'insensitive' } });
    if (query.visibility) filters.push({ visibility: query.visibility });
    if (query.expiringBefore) filters.push({ expiryDate: { lte: query.expiringBefore } });

    const { page, limit, ...args } = listArgs(query, {
      searchFields: ['documentType', 'fileName'],
      allowedSortFields: ['createdAt', 'documentType', 'fileName', 'expiryDate', 'visibility'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      include: documentInclude,
    });

    const [data, total] = await Promise.all([
      this.prisma.employeeDocument.findMany(args),
      this.prisma.employeeDocument.count({ where: args.where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    const document = await this.prisma.employeeDocument.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.visibilityWhere(user)] },
      include: documentInclude,
    });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  async update(id: string, dto: UpdateDocumentDto, user: RequestUser) {
    const document = await this.findById(id, user);
    if (!hasHrAccess(user.role) && document.employeeId !== user.employeeId) {
      throw new ForbiddenException('Cannot update this document');
    }
    if (!hasHrAccess(user.role) && dto.employeeId && dto.employeeId !== document.employeeId) {
      throw new ForbiddenException('Employees cannot reassign document ownership');
    }
    if (!hasHrAccess(user.role) && dto.uploadedById && dto.uploadedById !== document.uploadedById) {
      throw new ForbiddenException('Employees cannot change the document uploader');
    }
    if (!hasHrAccess(user.role) && dto.visibility === DocumentVisibility.PUBLIC) {
      throw new ForbiddenException('Only HR can publish documents to all employees');
    }
    if (dto.employeeId) await this.ensureEmployee(dto.employeeId);
    if (dto.uploadedById) await this.ensureEmployee(dto.uploadedById);
    return this.documentTransaction(async (tx) => {
      const updated = await tx.employeeDocument.update({ where: { id }, data: { ...dto, version: { increment: 1 } }, include: documentInclude });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'EmployeeDocument', entityId: id, summary: 'Document metadata updated' });
      return updated;
    });
  }

  async remove(id: string, user: RequestUser) {
    const document = await this.findById(id, user);
    if (!hasHrAccess(user.role) && document.employeeId !== user.employeeId) {
      throw new ForbiddenException('Cannot delete this document');
    }
    return this.documentTransaction(async (tx) => {
      const removed = await tx.employeeDocument.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'EmployeeDocument', entityId: id, summary: 'Document archived' });
      return removed;
    });
  }

  private visibilityWhere(user: RequestUser) {
    if (hasHrAccess(user.role)) return {};
    if (!user.employeeId) return { visibility: DocumentVisibility.PUBLIC };
    if (user.role === Role.MANAGER) {
      return {
        OR: [
          { visibility: DocumentVisibility.PUBLIC },
          { employeeId: user.employeeId, visibility: { in: [DocumentVisibility.EMPLOYEE_ONLY, DocumentVisibility.MANAGER_AND_HR] } },
          { employee: { managerId: user.employeeId }, visibility: DocumentVisibility.MANAGER_AND_HR },
          { uploadedById: user.employeeId },
        ],
      };
    }
    return {
      OR: [
        { visibility: DocumentVisibility.PUBLIC },
        { employeeId: user.employeeId, visibility: { in: [DocumentVisibility.EMPLOYEE_ONLY, DocumentVisibility.MANAGER_AND_HR] } },
        { uploadedById: user.employeeId },
      ],
    };
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
