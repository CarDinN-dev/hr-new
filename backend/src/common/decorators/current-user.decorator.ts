import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { RequestUser } from '../types/request-user.type';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: RequestUser; requestId?: string }>();
    return request.user ? {
      ...request.user,
      requestId: request.requestId,
      userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
      route: request.path.slice(0, 500),
      httpMethod: request.method.slice(0, 16),
    } : undefined;
  },
);
