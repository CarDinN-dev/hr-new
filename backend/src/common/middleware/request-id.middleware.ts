import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request & { requestId?: string }, response: Response, next: NextFunction) {
    const incoming = request.header('x-request-id');
    request.requestId = incoming && requestIdPattern.test(incoming) ? incoming : randomUUID();
    response.setHeader('X-Request-ID', request.requestId);
    next();
  }
}
