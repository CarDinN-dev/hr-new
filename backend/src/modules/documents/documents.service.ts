import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentVisibility, Role } from '@prisma/client';
import { hasHrAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta, softDelete } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { QueryDocumentsDto } from './dto/query-documents.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

const documentInclude = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true } },
  uploadedBy: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } },
};

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.employeeDocument.create({
      data: { ...dto, uploadedById },
      include: documentInclude,
    });
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
    return this.prisma.employeeDocument.update({ where: { id }, data: dto, include: documentInclude });
  }

  async remove(id: string, user: RequestUser) {
    const document = await this.findById(id, user);
    if (!hasHrAccess(user.role) && document.employeeId !== user.employeeId) {
      throw new ForbiddenException('Cannot delete this document');
    }
    return softDelete(this.prisma.employeeDocument, id, 'Document');
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
}
