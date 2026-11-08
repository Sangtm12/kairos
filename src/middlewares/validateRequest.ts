import type { NextFunction, Request, Response } from 'express';
import { flattenError, type ZodType } from 'zod';
import { ValidationError } from '../domain/errors.js';

export const validateRequest = (
  schema: ZodType,
  part: 'body' | 'query' | 'params' = 'body',
  localKey: string = 'validated',
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      throw new ValidationError('Input validation failed', flattenError(result.error).fieldErrors);
    } else {
      res.locals[localKey] = result.data;
      next();
    }
  };
};
