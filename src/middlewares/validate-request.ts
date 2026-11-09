import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../domain/errors.js';

export const validateRequest = (
  schema: ZodType,
  part: 'body' | 'query' | 'params' = 'body',
  localKey: string = 'validated',
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      // details = { field: firstMessage }; object-level rules (e.g. .refine) become the top-level message
      let message = 'Input validation failed';
      const details: Record<string, string> = {};
      for (const issue of result.error.issues) {
        if (issue.path.length === 0) message = issue.message;
        else details[issue.path.join('.')] ??= issue.message;
      }
      throw new ValidationError(message, details);
    } else {
      res.locals[localKey] = result.data;
      next();
    }
  };
};
