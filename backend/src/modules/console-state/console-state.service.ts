import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveConsoleStateDto } from './console-state.dto';

const stateId = 'default';

@Injectable()
export class ConsoleStateService {
  constructor(private readonly prisma: PrismaService) {}

  get() {
    return this.prisma.hrConsoleState.findUnique({ where: { id: stateId } });
  }

  async save(dto: SaveConsoleStateDto, user: RequestUser) {
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
}
