import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY, SUPER_ADMIN_ONLY_KEY } from '../../common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { hasActiveSuperAdminRole } from '../../common/authorization';
import { AuditAction, AuditOutcome } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const superAdminOnly = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY_KEY, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    if (superAdminOnly && (!request.user || !hasActiveSuperAdminRole(request.user))) {
      await this.recordDenial(context, 'Active Super Administrator role required');
      throw new ForbiddenException('Active Super Administrator role required');
    }

    const requiredAll = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredAll?.length && !requiredAny?.length) {
      await this.recordDenial(context, 'Endpoint permission policy is not configured');
      throw new ForbiddenException('Endpoint permission policy is not configured');
    }

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
    const actor = {
      ...request.user,
      requestId: request.requestId,
      userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
      route: request.path.slice(0, 500),
      httpMethod: request.method.slice(0, 16),
    };
    await this.audit.record(this.prisma, actor, {
      action: AuditAction.ACCESS,
      outcome: AuditOutcome.DENIED,
      resourceType: 'AuthorizationDenial',
      resourceId: request.path.slice(0, 500),
      summary,
      reason: summary,
    }).catch(() => undefined);
  }

}
