import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

type ResponseEnvelope<T> =
  | {
      success?: boolean;
      data?: T;
      meta?: unknown;
      message?: string;
    }
  | T;

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ResponseEnvelope<unknown>> {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<ResponseEnvelope<unknown>> {
    return next.handle().pipe(
      map((result: ResponseEnvelope<T>) => {
        if (result && typeof result === 'object' && 'success' in result) {
          return result;
        }

        if (
          result &&
          typeof result === 'object' &&
          'data' in result &&
          ('meta' in result || 'message' in result)
        ) {
          return { success: true, ...result };
        }

        return { success: true, data: result };
      }),
    );
  }
}
