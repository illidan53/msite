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

interface HttpRequestError extends Error {
  expose?: boolean;
  status?: number;
  statusCode?: number;
  type?: string;
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

  if (isInvalidJsonError(error)) {
    return {
      status: 400,
      body: {
        code: "INVALID_JSON",
        message: "Invalid JSON request body",
        source: "config",
      },
    };
  }

  if (isBadRequestError(error)) {
    return {
      status: 400,
      body: {
        code: "BAD_REQUEST",
        message: "Bad request",
        source: "config",
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

function isInvalidJsonError(error: unknown): error is HttpRequestError {
  if (!isHttpRequestError(error)) {
    return false;
  }

  return requestErrorStatus(error) === 400 && error.type === "entity.parse.failed";
}

function isBadRequestError(error: unknown): error is HttpRequestError {
  return isHttpRequestError(error) && requestErrorStatus(error) === 400;
}

function isHttpRequestError(error: unknown): error is HttpRequestError {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as HttpRequestError;

  return (
    typeof candidate.status === "number" ||
    typeof candidate.statusCode === "number" ||
    typeof candidate.type === "string"
  );
}

function requestErrorStatus(error: HttpRequestError): number | undefined {
  return error.status ?? error.statusCode;
}

export const apiErrorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const { body, status } = errorToApiResponse(error);
  response.status(status).json(body);
};
