import { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

/**
 * Custom application error with explicit status code and tracking codes.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = "INTERNAL_SERVER_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Standardized API Error Response interface
 */
export interface ApiErrorResponse {
  error: string;
  status: "error";
  code: string;
  correlationId?: string;
}

/**
 * Centrally manages Express errors, logging them structurely and shielding clients
 * from detailed stack traces in production.
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const isProduction = process.env.NODE_ENV === "production";
  const correlationId = (req.headers["x-correlation-id"] as string) || "system";

  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const errorCode = err instanceof AppError ? err.code : "INTERNAL_SERVER_ERROR";
  const errorMessage = err.message || "An unexpected error occurred.";

  // Log full detailed trace on the server using Pino
  logger.error(
    {
      correlationId,
      path: req.path,
      method: req.method,
      query: req.query,
      statusCode,
      errorCode,
      stack: err.stack,
    },
    `Request error occurred: ${errorMessage}`
  );

  const responseBody: ApiErrorResponse = {
    error: isProduction && statusCode === 500 ? "Internal Server Error" : errorMessage,
    status: "error",
    code: errorCode,
    correlationId,
  };

  res.status(statusCode).json(responseBody);
}
