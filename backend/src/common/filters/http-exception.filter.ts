import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

type ErrorResponseBody = {
  message?: string | string[];
  error?: string;
  statusCode?: number;
  [key: string]: unknown;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const databaseError = exception instanceof Prisma.PrismaClientKnownRequestError
      ? this.databaseError(exception.code)
      : undefined;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : databaseError?.status
          ? databaseError.status
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const body =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as ErrorResponseBody)
        : undefined;

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        exception instanceof Error ? exception.message : 'Unhandled exception',
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message:
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Internal server error'
          : databaseError?.message ?? body?.message ?? (exception instanceof Error ? exception.message : 'Unexpected error'),
      error: body?.error ?? HttpStatus[status],
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private databaseError(code: string) {
    if (code === 'P2002') {
      return { status: HttpStatus.CONFLICT, message: 'A record with the same unique value already exists' };
    }
    if (code === 'P2003') {
      return { status: HttpStatus.CONFLICT, message: 'This record is still referenced by other data' };
    }
    if (code === 'P2025') {
      return { status: HttpStatus.NOT_FOUND, message: 'Record not found' };
    }
    if (code === 'P2034') {
      return { status: HttpStatus.CONFLICT, message: 'Data changed in another request. Try again.' };
    }
    return undefined;
  }
}
