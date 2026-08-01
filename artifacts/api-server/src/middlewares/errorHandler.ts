import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public errorCode = 'BAD_REQUEST'
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Global Express error handling middleware enforcing standard response schema:
 * { success: false, message: "...", errorCode: "..." }
 */
export function globalErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'An unexpected internal server error occurred.';
  const errorCode = err.errorCode || (statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR');

  if (statusCode === 500) {
    console.error('[GlobalErrorHandler] Unhandled Exception:', err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    errorCode,
  });
}
