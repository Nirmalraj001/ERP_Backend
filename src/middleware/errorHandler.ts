import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  console.error(`[ERROR] ${req.method} ${req.url}:`, err)

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    })
    return
  }

  const statusCode = err.statusCode || 500
  const message = err.message || 'Internal server error occurred'

  res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === 'production' && statusCode === 500 ? 'Internal server error' : message,
  })
}
