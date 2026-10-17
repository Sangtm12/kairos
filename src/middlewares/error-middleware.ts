import { AppError } from '../domain/errors.js';
import type { Request, Response, NextFunction } from 'express';
import { asyncLocalStorage } from './request-log.js';

export const errorMiddleware = (err: Error, req: Request, res: Response, next: NextFunction) => {
  const requestLog = asyncLocalStorage.getStore();

  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.errorCode,
        message: err.message,
        details: err.details,
      },
    });
  }

  console.error({
    error: err,
    request: requestLog,
  });
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    },
  });
};
