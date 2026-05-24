import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export interface ApiErrorBody {
  code: string;
  details?: unknown;
  message: string;
  source: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly source: string;
  readonly status: number;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { cause?: unknown; details?: unknown; source?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.source = options.source ?? "config";
    this.details = options.details;
  }
}

export function errorToApiResponse(error: unknown): { body: ApiErrorBody; status: number } {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        code: "VALIDATION_ERROR",
        message: "Invalid config input",
        source: "config",
        details: error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path,
        })),
      },
    };
  }

  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        code: error.code,
        message: error.message,
        source: error.source,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }

  return {
    status: 500,
    body: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      source: "config",
    },
  };
}

export const apiErrorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const { body, status } = errorToApiResponse(error);
  response.status(status).json(body);
};
