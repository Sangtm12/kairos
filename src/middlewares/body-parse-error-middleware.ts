import type { Request, Response, NextFunction } from 'express';
import { BadRequestError } from '../domain/errors.js';

// The parser's own message is dropped: it describes library internals and can echo the body.
export const bodyParseErrorMiddleware = (
  err: Error,
  _req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (err instanceof SyntaxError && 'type' in err && err.type === 'entity.parse.failed') {
    return next(new BadRequestError('Request body is not valid JSON'));
  }
  next(err);
};
