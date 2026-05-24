import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { ApiError } from "./apiError";

export interface AuthGuardOptions {
  adminToken?: string;
  nodeEnv?: string;
}

export function requireAdminToken(options: AuthGuardOptions = {}): RequestHandler {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const adminToken = options.adminToken ?? process.env.APP_ADMIN_TOKEN;

  return (request, _response, next) => {
    if (nodeEnv === "development" || nodeEnv === "test") {
      next();
      return;
    }

    if (!adminToken) {
      next(new ApiError(500, "ADMIN_TOKEN_MISSING", "Admin token is not configured"));
      return;
    }

    const providedToken = request.header("x-admin-token");

    if (!providedToken || !tokensMatch(providedToken, adminToken)) {
      next(new ApiError(401, "UNAUTHORIZED", "Unauthorized"));
      return;
    }

    next();
  };
}

function tokensMatch(providedToken: string, adminToken: string): boolean {
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(adminToken);

  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
