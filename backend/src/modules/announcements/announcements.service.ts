import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccessScopeType, AnnouncementAttachmentKind, AuditAction, DocumentScanStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { DocumentMalwareScannerService } from '../documents/document-malware-scanner.service';
import { DocumentStorageService } from '../documents/document-storage.service';
import { isAllowedDocumentMimeType } from '../documents/document-upload';
import { NotificationsService } from '../notifications/notifications.service';
import { imageBlockSignature, parseAnnouncementBlocks, plainTextFromBlocks, type AnnouncementContentBlock } from './announcement-content';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { QueryAnnouncementsDto } from './dto/query-announcements.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { UploadAnnouncementAttachmentDto } from './dto/upload-announcement-attachment.dto';

const inlineImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const inlineEmailByteLimit = 2 * 1024 * 1024;

const announcementAttachmentSelect = {
  id: true,
  uploadKey: true,
  kind: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  altText: true,
  sortOrder: true,
  scanStatus: true,
  scannedAt: true,
  createdAt: true,
} satisfies Prisma.AnnouncementAttachmentSelect;

const announcementInclude = {
  department: true,
  createdBy: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } },
  attachments: { where: { deletedAt: null }, orderBy: [{ kind: 'asc' as const }, { sortOrder: 'asc' as const }], select: announcementAttachmentSelect },
} satisfies Prisma.AnnouncementInclude;

@Injectable()
export class AnnouncementsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnnouncementsService.name);
  private deliveryTimer?: NodeJS.Timeout;
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly storage: DocumentStorageService,
    private readonly scanner: DocumentMalwareScannerService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (!this.notifications.announcementEmailEnabled()) return;
    this.deliveryTimer = setInterval(() => void this.dispatchDueAnnouncements(), 15_000);
    this.deliveryTimer.unref();
    this.wakeDispatch();
  }

  onModuleDestroy() {
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
  }

  async create(dto: CreateAnnouncementDto, user: RequestUser) {
    this.assertSystemScope(user, 'announcement.manage');
    if (!user.employeeId) throw new NotFoundException('Creator employee profile is required');
    const departmentId = await this.scopedDepartmentId(dto.departmentId, user);
    await this.assertAudienceScope(dto.audienceRoles);
    this.validateSchedule(dto.publishedAt ?? undefined, dto.expiresAt ?? undefined);
    const blocks = parseAnnouncementBlocks(dto.contentBlocks);
    const content = blocks ? plainTextFromBlocks(blocks) : dto.content.trim();
    if (!content) throw new BadRequestException('Announcement message text is required');
    const active = dto.isActive ?? true;
    if (active && blocks?.some((block) => block.type === 'image')) {
      throw new BadRequestException('Save picture announcements as a draft, upload the pictures, then publish');
    }
    const emailEnabled = dto.emailEnabled ?? true;
    this.assertEmailAvailable(active, emailEnabled);

    const announcement = await this.prisma.$transaction(async (tx) => {
      const { audienceRoles, contentBlocks: _contentBlocks, ...input } = dto;
      const created = await tx.announcement.create({
        data: {
          ...input,
          content,
          contentBlocks: blocks as unknown as Prisma.InputJsonValue | undefined,
          departmentId,
          audienceRoleCodes: audienceRoles ?? [],
          emailEnabled,
          createdById: user.employeeId!,
        },
        include: announcementInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'Announcement', entityId: created.id, summary: active ? 'Announcement created and published' : 'Announcement draft created' });
      return created;
    });
    if (announcement.isActive && announcement.emailEnabled) this.wakeDispatch();
    return announcement;
  }

  async list(query: QueryAnnouncementsDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [await this.accessWhere(user)];
    if (query.audienceRole) filters.push({ audienceRoleCodes: { has: query.audienceRole } });
    if (query.departmentId) filters.push({ departmentId: query.departmentId });
    if (query.isActive !== undefined) filters.push({ isActive: query.isActive });

    const { page, limit, ...args } = listArgs(query, {
      searchFields: ['title', 'content'],
      allowedSortFields: ['createdAt', 'publishedAt', 'expiresAt', 'title'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      include: announcementInclude,
    });
    const [data, total] = await Promise.all([
      this.prisma.announcement.findMany(args),
      this.prisma.announcement.count({ where: args.where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    const announcement = await this.prisma.announcement.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, await this.accessWhere(user)] },
      include: announcementInclude,
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  async update(id: string, dto: UpdateAnnouncementDto, user: RequestUser) {
    const current = await this.ensureExists(id);
    this.assertSystemScope(user, 'announcement.manage', id);
    const departmentProvided = Object.prototype.hasOwnProperty.call(dto, 'departmentId');
    const departmentId = departmentProvided ? dto.departmentId ?? null : undefined;
    if (departmentId) await this.ensureDepartment(departmentId);
    await this.assertAudienceScope(dto.audienceRoles ?? current.audienceRoleCodes);
    const publishedAt = Object.prototype.hasOwnProperty.call(dto, 'publishedAt') ? dto.publishedAt ?? undefined : current.publishedAt ?? undefined;
    const expiresAt = Object.prototype.hasOwnProperty.call(dto, 'expiresAt') ? dto.expiresAt ?? undefined : current.expiresAt ?? undefined;
    this.validateSchedule(publishedAt, expiresAt);

    const currentBlocks = this.blocksFor(current.contentBlocks, current.content);
    let blocks = dto.contentBlocks !== undefined ? parseAnnouncementBlocks(dto.contentBlocks) : undefined;
    if (dto.content !== undefined && dto.contentBlocks === undefined && current.contentBlocks !== null) {
      blocks = [{ id: randomUUID(), type: 'paragraph', text: dto.content }];
    }
    if (current.emailQueuedAt) {
      if (dto.audienceRoles !== undefined || departmentProvided || dto.publishedAt !== undefined || dto.emailEnabled !== undefined) {
        throw new BadRequestException('Audience, schedule and email settings are locked after email is queued');
      }
      if (blocks && imageBlockSignature(blocks) !== imageBlockSignature(currentBlocks)) {
        throw new BadRequestException('Pictures are locked after email is queued');
      }
    }

    const effectiveBlocks = blocks ?? currentBlocks;
    const active = dto.isActive ?? current.isActive;
    const emailEnabled = dto.emailEnabled ?? current.emailEnabled;
    if (active) await this.assertPublishable(id, effectiveBlocks);
    this.assertEmailAvailable(active, emailEnabled);
    const content = blocks ? plainTextFromBlocks(blocks) : dto.content?.trim();
    if (content !== undefined && !content) throw new BadRequestException('Announcement message text is required');

    const updated = await this.prisma.$transaction(async (tx) => {
      const { audienceRoles, contentBlocks: _contentBlocks, ...input } = dto;
      const record = await tx.announcement.update({
        where: { id },
        data: {
          ...input,
          ...(content !== undefined ? { content } : {}),
          ...(blocks ? { contentBlocks: blocks as unknown as Prisma.InputJsonValue } : {}),
          ...(departmentProvided ? { departmentId } : {}),
          ...(audienceRoles ? { audienceRoleCodes: audienceRoles } : {}),
          version: { increment: 1 },
        } as Prisma.AnnouncementUncheckedUpdateInput,
        include: announcementInclude,
      });
      if (blocks) {
        for (const [sortOrder, block] of blocks.filter((item) => item.type === 'image').entries()) {
          await tx.announcementAttachment.updateMany({
            where: { announcementId: id, uploadKey: block.attachmentKey, kind: AnnouncementAttachmentKind.INLINE_IMAGE, deletedAt: null },
            data: { altText: block.altText, sortOrder },
          });
        }
      }
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Announcement', entityId: id, summary: current.emailQueuedAt ? 'Announcement website content updated after email queue' : 'Announcement updated' });
      return record;
    });
    if (updated.isActive && updated.emailEnabled && !updated.emailQueuedAt) this.wakeDispatch();
    return updated;
  }

  async publish(id: string, user: RequestUser) {
    const current = await this.ensureExists(id);
    this.assertSystemScope(user, 'announcement.manage', id);
    const blocks = this.blocksFor(current.contentBlocks, current.content);
    this.validateSchedule(current.publishedAt ?? undefined, current.expiresAt ?? undefined);
    await this.assertPublishable(id, blocks);
    this.assertEmailAvailable(true, current.emailEnabled);
    const published = await this.prisma.$transaction(async (tx) => {
      const record = await tx.announcement.update({
        where: { id },
        data: { isActive: true, contentBlocks: blocks as unknown as Prisma.InputJsonValue, content: plainTextFromBlocks(blocks), version: { increment: 1 } },
        include: announcementInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Announcement', entityId: id, summary: current.publishedAt && current.publishedAt > new Date() ? 'Announcement scheduled' : 'Announcement published' });
      return record;
    });
    if (published.emailEnabled && !published.emailQueuedAt) this.wakeDispatch();
    return published;
  }

  async uploadAttachment(id: string, dto: UploadAnnouncementAttachmentDto, file: Express.Multer.File | undefined, user: RequestUser) {
    await this.ensureExists(id);
    this.assertSystemScope(user, 'announcement.manage', id);
    if (!file?.buffer?.length) throw new BadRequestException('An attachment file is required');
    if (!isAllowedDocumentMimeType(file.mimetype)) throw new BadRequestException('Attachments must be PDF, JPEG, PNG, WebP, DOCX or XLSX');
    if (file.buffer.length > 10 * 1024 * 1024) throw new BadRequestException('Attachments must be 10 MB or less');
    const altText = dto.altText?.trim() || null;
    if (dto.kind === AnnouncementAttachmentKind.INLINE_IMAGE) {
      if (!inlineImageMimeTypes.has(file.mimetype)) throw new BadRequestException('Inline pictures must be JPEG, PNG or WebP');
      if (!altText) throw new BadRequestException('Inline pictures require alt text');
    }
    let scanResult: string;
    try {
      scanResult = await this.scanner.scanBuffer(file.buffer);
    } catch {
      throw new ServiceUnavailableException('The attachment could not be verified by the malware scanner');
    }
    if (scanResult.endsWith('FOUND')) throw new BadRequestException('The attachment was rejected by the malware scanner');

    const attachmentId = randomUUID();
    const safeFileName = file.originalname.replace(/[\u0000-\u001f\u007f]+/g, '').slice(0, 180) || 'attachment';
    let stored: Awaited<ReturnType<DocumentStorageService['uploadPrivate']>> | undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Announcement" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const [current, kindCount, duplicate, inlineBytes] = await Promise.all([
          tx.announcement.findUnique({ where: { id }, select: { emailQueuedAt: true, deletedAt: true } }),
          tx.announcementAttachment.count({ where: { announcementId: id, kind: dto.kind, deletedAt: null } }),
          tx.announcementAttachment.findFirst({ where: { announcementId: id, uploadKey: dto.uploadKey, deletedAt: null }, select: announcementAttachmentSelect }),
          dto.kind === AnnouncementAttachmentKind.INLINE_IMAGE
            ? tx.announcementAttachment.aggregate({ where: { announcementId: id, kind: AnnouncementAttachmentKind.INLINE_IMAGE, deletedAt: null }, _sum: { sizeBytes: true } })
            : Promise.resolve({ _sum: { sizeBytes: 0 } }),
        ]);
        if (!current || current.deletedAt) throw new NotFoundException('Announcement not found');
        if (current.emailQueuedAt) throw new BadRequestException('Attachments are locked after email is queued');
        if (duplicate) return duplicate;
        if (kindCount >= 5) throw new BadRequestException(dto.kind === AnnouncementAttachmentKind.INLINE_IMAGE ? 'Announcements support up to five inline pictures' : 'Announcements support up to five file attachments');
        if (dto.kind === AnnouncementAttachmentKind.INLINE_IMAGE && (inlineBytes._sum.sizeBytes ?? 0) + file.buffer.length > inlineEmailByteLimit) {
          throw new BadRequestException('Inline pictures must total 2 MB or less for reliable email delivery');
        }
        stored = await this.storage.uploadPrivate(`announcements/${id}`, `${attachmentId}-${safeFileName}`, file.mimetype, file.buffer, { announcementId: id, uploadKey: dto.uploadKey });
        const attachment = await tx.announcementAttachment.create({
          data: {
            id: attachmentId,
            announcementId: id,
            uploadKey: dto.uploadKey,
            kind: dto.kind,
            fileName: safeFileName,
            objectName: stored.objectName,
            objectGeneration: stored.generation,
            contentType: file.mimetype,
            sizeBytes: file.buffer.length,
            sha256: stored.sha256,
            altText,
            sortOrder: dto.sortOrder ?? 0,
            uploadedByUserId: user.id,
            scanStatus: DocumentScanStatus.CLEAN,
            scannedAt: new Date(),
            scanResultCode: scanResult.slice(0, 200),
          },
          select: announcementAttachmentSelect,
        });
        await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'AnnouncementAttachment', entityId: attachment.id, summary: 'Announcement attachment scanned and uploaded', metadata: { announcementId: id, kind: dto.kind, sha256: stored.sha256 } });
        return attachment;
      }, { timeout: 120_000 });
    } catch (error) {
      if (stored) await this.storage.remove(stored.objectName, stored.generation).catch(() => undefined);
      throw error;
    }
  }

  async removeAttachment(id: string, attachmentId: string, user: RequestUser) {
    const announcement = await this.ensureExists(id);
    this.assertSystemScope(user, 'announcement.manage', id);
    if (announcement.emailQueuedAt) throw new BadRequestException('Attachments are locked after email is queued');
    const attachment = await this.prisma.announcementAttachment.findFirst({ where: { id: attachmentId, announcementId: id, deletedAt: null }, select: { id: true, objectName: true, objectGeneration: true } });
    if (!attachment) throw new NotFoundException('Announcement attachment not found');
    const removed = await this.prisma.$transaction(async (tx) => {
      const removed = await tx.announcementAttachment.update({ where: { id: attachmentId }, data: { deletedAt: new Date() }, select: announcementAttachmentSelect });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'AnnouncementAttachment', entityId: attachmentId, summary: 'Announcement attachment removed', metadata: { announcementId: id } });
      return removed;
    });
    await this.storage.remove(attachment.objectName, attachment.objectGeneration).catch((error) => this.logger.warn(`Announcement attachment ${attachmentId} storage cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`));
    return removed;
  }

  async attachmentContent(id: string, attachmentId: string, user: RequestUser) {
    await this.findById(id, user);
    const attachment = await this.prisma.announcementAttachment.findFirst({
      where: { id: attachmentId, announcementId: id, deletedAt: null, scanStatus: DocumentScanStatus.CLEAN },
      select: { fileName: true, contentType: true, kind: true, objectName: true, objectGeneration: true },
    });
    if (!attachment) throw new NotFoundException('Announcement attachment not found');
    const buffer = await this.storage.download(attachment.objectName, attachment.objectGeneration);
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, entityType: 'AnnouncementAttachment', entityId: attachmentId, summary: 'Announcement attachment downloaded', metadata: { announcementId: id } });
    return { ...attachment, buffer };
  }

  async deliveryStatus(id: string, user: RequestUser) {
    const announcement = await this.ensureExists(id);
    this.assertSystemScope(user, 'announcement.manage', id);
    const where: Prisma.EmailDeliveryWhereInput = { notification: { resourceType: 'Announcement', resourceId: id } };
    const [total, sent, pending, failed] = await Promise.all([
      this.prisma.emailDelivery.count({ where }),
      this.prisma.emailDelivery.count({ where: { ...where, sentAt: { not: null } } }),
      this.prisma.emailDelivery.count({ where: { ...where, sentAt: null } }),
      this.prisma.emailDelivery.count({ where: { ...where, sentAt: null, lastError: { not: null } } }),
    ]);
    return { emailEnabled: announcement.emailEnabled, queuedAt: announcement.emailQueuedAt, total, sent, pending, failed };
  }

  async remove(id: string, user: RequestUser) {
    await this.ensureExists(id);
    this.assertSystemScope(user, 'announcement.manage', id);
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.announcement.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } }, include: announcementInclude });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'Announcement', entityId: id, summary: 'Announcement archived' });
      return removed;
    });
  }

  private wakeDispatch() {
    if (this.notifications.announcementEmailEnabled()) setTimeout(() => void this.dispatchDueAnnouncements(), 0).unref();
  }

  private async dispatchDueAnnouncements() {
    if (!this.notifications.announcementEmailEnabled() || this.dispatching) return;
    this.dispatching = true;
    try {
      for (let index = 0; index < 10; index += 1) {
        const now = new Date();
        const announcement = await this.prisma.announcement.findFirst({
          where: {
            deletedAt: null,
            isActive: true,
            emailEnabled: true,
            emailQueuedAt: null,
            AND: [
              { OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] },
              { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            ],
          },
          orderBy: { createdAt: 'asc' },
          include: announcementInclude,
        });
        if (!announcement) break;
        const blocks = this.blocksFor(announcement.contentBlocks, announcement.content);
        const recipients = await this.resolveRecipients(announcement.id, announcement.audienceRoleCodes, announcement.departmentId);
        await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.announcement.updateMany({
            where: {
              id: announcement.id,
              deletedAt: null,
              isActive: true,
              emailEnabled: true,
              emailQueuedAt: null,
              AND: [
                { OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] },
                { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
              ],
            },
            data: { emailQueuedAt: now },
          });
          if (!claimed.count) return;
          await this.notifications.createAnnouncement(tx, {
            announcementId: announcement.id,
            title: announcement.title,
            content: announcement.content,
            blocks,
            attachments: announcement.attachments.map((attachment) => ({ id: attachment.id, uploadKey: attachment.uploadKey, kind: attachment.kind, fileName: attachment.fileName })),
            recipients,
          });
          await this.audit.record(tx, null, { action: AuditAction.CREATE, entityType: 'AnnouncementEmailDelivery', entityId: announcement.id, summary: 'Announcement email deliveries queued', metadata: { recipientCount: recipients.length } });
        });
      }
    } catch (error) {
      this.logger.error(`Announcement email queue failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      this.dispatching = false;
    }
  }

  private async resolveRecipients(announcementId: string, audienceRoles: string[], departmentId: string | null) {
    const candidates = await this.prisma.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, email: true, employee: { select: { firstName: true, departmentId: true, deletedAt: true } } },
      orderBy: { email: 'asc' },
    });
    const eligible = candidates.filter((candidate) => !departmentId || (candidate.employee?.deletedAt === null && candidate.employee.departmentId === departmentId));
    const recipients: Array<{ id: string; email: string; firstName?: string | null }> = [];
    for (let offset = 0; offset < eligible.length; offset += 20) {
      const batch = await Promise.all(eligible.slice(offset, offset + 20).map(async (candidate) => {
        try {
          const context = await this.authorization.loadUserContext(candidate.id);
          const user = this.authorization.toRequestUser(context, { id: 'announcement-email', csrfToken: '', provider: 'system' });
          if (audienceRoles.length && !audienceRoles.some((role) => user.roles.includes(role))) return null;
          if (!this.authorization.permissionAllowedForScope(user, 'announcement.read', AccessScopeType.ALL_SYSTEM, announcementId)) return null;
          return { id: candidate.id, email: candidate.email, firstName: candidate.employee?.firstName };
        } catch {
          return null;
        }
      }));
      recipients.push(...batch.filter((recipient): recipient is NonNullable<typeof recipient> => recipient !== null));
    }
    return recipients;
  }

  private async assertPublishable(id: string, blocks: AnnouncementContentBlock[]) {
    const imageKeys = blocks.filter((block) => block.type === 'image').map((block) => block.attachmentKey);
    if (!imageKeys.length) return;
    const attachments = await this.prisma.announcementAttachment.findMany({
      where: { announcementId: id, uploadKey: { in: imageKeys }, kind: AnnouncementAttachmentKind.INLINE_IMAGE, deletedAt: null, scanStatus: DocumentScanStatus.CLEAN },
      select: { uploadKey: true },
    });
    if (new Set(attachments.map((attachment) => attachment.uploadKey)).size !== new Set(imageKeys).size) {
      throw new BadRequestException('Every inline picture must finish uploading before publication');
    }
  }

  private blocksFor(value: Prisma.JsonValue | null, content: string): AnnouncementContentBlock[] {
    if (value !== null) return parseAnnouncementBlocks(value) ?? [];
    return [{ id: randomUUID(), type: 'paragraph', text: content }];
  }

  private assertEmailAvailable(active: boolean, emailEnabled: boolean) {
    if (active && emailEnabled && !this.notifications.announcementEmailEnabled()) {
      throw new ServiceUnavailableException('Announcement email delivery is not configured');
    }
  }

  private async accessWhere(user: RequestUser): Promise<Prisma.AnnouncementWhereInput> {
    const scopes: Prisma.AnnouncementWhereInput[] = [];
    const manageRule = this.authorization.scopeRule(user, 'announcement.manage', AccessScopeType.ALL_SYSTEM);
    if (manageRule.unrestricted) {
      if (!manageRule.excludeIds.length) return {};
      scopes.push({ id: { notIn: manageRule.excludeIds } });
    } else if (manageRule.includeIds.length) scopes.push({ id: { in: manageRule.includeIds, notIn: manageRule.excludeIds } });

    const readRule = this.authorization.scopeRule(user, 'announcement.read', AccessScopeType.ALL_SYSTEM);
    if (!readRule.unrestricted && !readRule.includeIds.length) return scopes.length ? { OR: scopes } : { id: '__no_announcement_scope__' };
    const now = new Date();
    const employee = user.employeeId ? await this.prisma.employee.findFirst({ where: { id: user.employeeId, deletedAt: null }, select: { departmentId: true } }) : null;
    const departmentScope = employee?.departmentId ? { OR: [{ departmentId: null }, { departmentId: employee.departmentId }] } : { departmentId: null };
    const activeAudience: Prisma.AnnouncementWhereInput = {
      AND: [
        { isActive: true },
        { OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [{ audienceRoleCodes: { isEmpty: true } }, { audienceRoleCodes: { hasSome: user.roles } }] },
        departmentScope,
      ],
    };
    if (readRule.unrestricted && readRule.excludeIds.length) activeAudience.AND = [...(activeAudience.AND as Prisma.AnnouncementWhereInput[]), { id: { notIn: readRule.excludeIds } }];
    else if (!readRule.unrestricted) activeAudience.AND = [...(activeAudience.AND as Prisma.AnnouncementWhereInput[]), { id: { in: readRule.includeIds, notIn: readRule.excludeIds } }];
    scopes.push(activeAudience);
    return { OR: scopes };
  }

  private async scopedDepartmentId(requestedDepartmentId: string | null | undefined, _user: RequestUser) {
    if (requestedDepartmentId) await this.ensureDepartment(requestedDepartmentId);
    return requestedDepartmentId ?? null;
  }

  private validateSchedule(publishedAt?: Date, expiresAt?: Date) {
    if (publishedAt && expiresAt && expiresAt <= publishedAt) throw new BadRequestException('expiresAt must be after publishedAt');
  }

  private async assertAudienceScope(audienceRoles: string[] | undefined) {
    if (audienceRoles?.some((role) => !/^[A-Z][A-Z0-9_]{1,99}$/.test(role))) throw new ForbiddenException('Announcement audience is invalid');
    if (!audienceRoles?.length) return;
    const count = await this.prisma.role.count({ where: { code: { in: [...new Set(audienceRoles)] }, isActive: true } });
    if (count !== new Set(audienceRoles).size) throw new BadRequestException('Announcement audience contains an unknown or inactive role');
  }

  private assertSystemScope(user: RequestUser, permission: string, resourceId?: string) {
    if (this.authorization.permissionAllowedForScope(user, permission, AccessScopeType.ALL_SYSTEM, resourceId)) return;
    throw new NotFoundException(resourceId ? 'Announcement not found' : 'Resource not found');
  }

  private async ensureDepartment(departmentId: string) {
    const department = await this.prisma.department.findFirst({ where: { id: departmentId, deletedAt: null } });
    if (!department) throw new NotFoundException('Department not found');
  }

  private async ensureExists(id: string) {
    const announcement = await this.prisma.announcement.findFirst({ where: { id, deletedAt: null }, include: announcementInclude });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }
}
