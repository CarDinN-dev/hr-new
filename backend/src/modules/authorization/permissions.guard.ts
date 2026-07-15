import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const requiredAll = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredAll?.length && !requiredAny?.length) {
      await this.recordDenial(context, 'Endpoint permission policy is not configured');
      throw new ForbiddenException('Endpoint permission policy is not configured');
    }

    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const permissions = new Set(request.user?.permissions ?? []);
    if (requiredAll?.some((permission) => !permissions.has(permission))) {
      await this.recordDenial(context, 'Required permission missing');
      throw new ForbiddenException('Insufficient permission');
    }
    if (requiredAny?.length && !requiredAny.some((permission) => permissions.has(permission))) {
      await this.recordDenial(context, 'Alternative permission missing');
      throw new ForbiddenException('Insufficient permission');
    }
    return true;
  }

  private async recordDenial(context: ExecutionContext, summary: string) {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser; requestId?: string }>();
    if (!request.user) return;
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: request.user.id,
        requestId: request.requestId,
        action: AuditAction.ACCESS,
        entityType: 'AuthorizationDenial',
        entityId: request.path.slice(0, 500),
        summary,
      },
    }).catch(() => undefined);
  }
}
