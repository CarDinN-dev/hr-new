import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveConsoleStateDto } from './console-state.dto';

const stateId = 'default';
const backupIntervalMs = 8 * 60 * 60 * 1000;
const backupRetention = 90;

@Injectable()
export class ConsoleStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsoleStateService.name);
  private backupTimer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.ensureScheduledBackup();
    // ponytail: one process owns this timer; move scheduling outside the app if replicas are added.
    this.backupTimer = setInterval(() => void this.ensureScheduledBackup(), backupIntervalMs);
  }

  onModuleDestroy() {
    if (this.backupTimer) clearInterval(this.backupTimer);
  }

  get() {
    return this.prisma.hrConsoleState.findUnique({ where: { id: stateId } });
  }

  async save(dto: SaveConsoleStateDto, user: RequestUser) {
    this.assertWorkspaceShape(dto.data);
    const current = await this.prisma.hrConsoleState.findUnique({ where: { id: stateId } });
    if (!current) {
      return this.prisma.hrConsoleState.create({
        data: { id: stateId, data: dto.data as unknown as Prisma.InputJsonValue, updatedById: user.id },
      });
    }

    if (!dto.updatedAt || current.updatedAt.toISOString() !== new Date(dto.updatedAt).toISOString()) {
      throw new ConflictException('Workspace changed in another session. Reload before saving.');
    }

    const updated = await this.prisma.hrConsoleState.updateMany({
      where: { id: stateId, updatedAt: current.updatedAt },
      data: { data: dto.data as unknown as Prisma.InputJsonValue, updatedById: user.id },
    });

    if (updated.count !== 1) {
      throw new ConflictException('Workspace changed in another session. Reload before saving.');
    }

    return this.get();
  }

  async backupStatus() {
    const [count, latest] = await this.prisma.$transaction([
      this.prisma.hrConsoleStateBackup.count(),
      this.prisma.hrConsoleStateBackup.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, createdAt: true } }),
    ]);
    return { count, latest, intervalHours: 8 };
  }

  async createBackup(kind: 'MANUAL' | 'SCHEDULED' | 'ROLLBACK_SAFETY', createdById?: string) {
    const state = await this.prisma.hrConsoleState.findUnique({ where: { id: stateId } });
    if (!state) throw new NotFoundException('Save the workspace before taking a backup');

    const backup = await this.prisma.hrConsoleStateBackup.create({
      data: { data: state.data as Prisma.InputJsonValue, stateUpdatedAt: state.updatedAt, kind, createdById },
      select: { id: true, kind: true, createdAt: true },
    });
    await this.trimBackups();
    return backup;
  }

  async rollbackLatest(createdById: string) {
    const restored = await this.prisma.$transaction(async (tx) => {
      const [state, backup] = await Promise.all([
        tx.hrConsoleState.findUnique({ where: { id: stateId } }),
        tx.hrConsoleStateBackup.findFirst({ orderBy: { createdAt: 'desc' } }),
      ]);
      if (!state) throw new NotFoundException('No workspace exists to restore');
      if (!backup) throw new NotFoundException('No backup is available');

      await tx.hrConsoleStateBackup.create({
        data: { data: state.data as Prisma.InputJsonValue, stateUpdatedAt: state.updatedAt, kind: 'ROLLBACK_SAFETY', createdById },
      });
      const updated = await tx.hrConsoleState.updateMany({
        where: { id: stateId, updatedAt: state.updatedAt },
        data: { data: backup.data as Prisma.InputJsonValue, updatedById: createdById },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Workspace changed during rollback. Try again.');
      }
      return tx.hrConsoleState.findUnique({ where: { id: stateId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.trimBackups();
    return restored;
  }

  private async ensureScheduledBackup() {
    try {
      const [state, latest] = await Promise.all([
        this.prisma.hrConsoleState.findUnique({ where: { id: stateId }, select: { id: true } }),
        this.prisma.hrConsoleStateBackup.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ]);
      if (state && (!latest || Date.now() - latest.createdAt.getTime() >= backupIntervalMs)) await this.createBackup('SCHEDULED');
    } catch (error) {
      this.logger.error('Scheduled HR backup failed', error instanceof Error ? error.stack : undefined);
    }
  }

  private async trimBackups() {
    const expired = await this.prisma.hrConsoleStateBackup.findMany({
      orderBy: { createdAt: 'desc' },
      skip: backupRetention,
      select: { id: true },
    });
    if (expired.length) await this.prisma.hrConsoleStateBackup.deleteMany({ where: { id: { in: expired.map(item => item.id) } } });
  }

  private assertWorkspaceShape(data: Record<string, unknown>) {
    const arrays = [
      'employees', 'leaves', 'payroll', 'businessTrips', 'expenses', 'loans',
      'loanRepayments', 'jobs', 'candidates', 'eosRecords', 'documents',
    ];
    if (arrays.some((key) => !Array.isArray(data[key]))) {
      throw new BadRequestException('Workspace data is missing a required record collection');
    }
    for (const key of ['attendance', 'attendanceApprovals', 'settings']) {
      const value = data[key];
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException(`Workspace data has an invalid ${key} section`);
      }
    }
    const settings = data.settings as Record<string, unknown>;
    if (!settings.company || typeof settings.company !== 'object' || Array.isArray(settings.company)) {
      throw new BadRequestException('Workspace data has an invalid company settings section');
    }
    if (!Array.isArray(settings.departments) || !Array.isArray(settings.leaveTypes)) {
      throw new BadRequestException('Workspace data has invalid settings collections');
    }
  }
}
