import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * Propagates an x-trace-id through every request, so the gateway trace id is
 * echoed in responses and included in the error body (arch.md section 10).
 */
@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-trace-id');
    const traceId = incoming && incoming.length <= 128 ? incoming : randomBytes(16).toString('hex');
    (req as Request & { traceId: string }).traceId = traceId;
    res.setHeader('x-trace-id', traceId);
    next();
  }
}
