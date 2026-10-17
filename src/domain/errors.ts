type ErrorCode = 'NOT_FOUND_ERROR' | 'VALIDATION_ERROR' | 'BAD_REQUEST_ERROR' | 'CONFLICT_ERROR' | 'UNAUTHORIZED_ERROR' | 'FORBIDDEN_ERROR';

export class AppError extends Error {
  statusCode: number;
  errorCode: ErrorCode;
  details: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    errorCode: ErrorCode,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.name = new.target.name; // Set the name of the error to the class name
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 404, 'NOT_FOUND_ERROR', details);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'BAD_REQUEST_ERROR', details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 409, 'CONFLICT_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 401, 'UNAUTHORIZED_ERROR', details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 403, 'FORBIDDEN_ERROR', details);
  }
}
