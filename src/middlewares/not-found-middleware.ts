import type { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../domain/errors.js';

// Registered after every route: a request only reaches this point when nothing else matched.
// Handing a NotFoundError to next() lets errorMiddleware format it like every other error.
export const notFoundMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
};
