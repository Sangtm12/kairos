import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type RequestLog = {
  requestId: string;
  startTime: bigint;
};

export const asyncLocalStorage = new AsyncLocalStorage<RequestLog>();

export const requestLogMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const requestId = req.get('x-request-id') || randomUUID();
  const requestMetadataStore = {
    requestId,
    startTime: process.hrtime.bigint(),
  };

  res.set('X-Request-Id', requestId);
  res.on('finish', () => {
    console.log({
      requestId,
      method: req.method,
      path: req.originalUrl, //express rewrites req.path inside a mounted router
      status: res.statusCode,
      duration: Number(process.hrtime.bigint() - requestMetadataStore.startTime) / 1e6,
    });
  });

  asyncLocalStorage.run(requestMetadataStore, next);
};
