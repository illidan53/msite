import type { Request } from "express";
import type { researchAccess } from "../research/access";
import { ApiError } from "./apiError";

/** host[:port] of an Origin header; null for "null" or anything unparsable. */
const hostOf = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
};

/**
 * Gate for owner-only writes: the research IP allowlist, same-site only and,
 * for methods a cross-site form could send, a JSON body. The IP gate alone
 * lets any page the owner visits post through their browser (CSRF); JSON
 * forces a CORS preflight. DELETE is never a CORS-simple method, so it is
 * always preflighted and passes `requireJson: false`.
 */
export function assertOwnerWrite(
  access: ReturnType<typeof researchAccess>,
  req: Request,
  options: { source: string; forbidden: string; requireJson?: boolean },
) {
  const { source } = options;
  if (!access(req).canRun)
    throw new ApiError(403, "RESEARCH_IP_FORBIDDEN", options.forbidden, {
      source,
    });
  const origin = req.get("origin");
  if (
    req.get("sec-fetch-site") === "cross-site" ||
    (origin !== undefined && hostOf(origin) !== req.get("host"))
  )
    throw new ApiError(
      403,
      "CROSS_SITE_REQUEST",
      "Cross-site requests are not allowed",
      { source },
    );
  if ((options.requireJson ?? true) && !req.is("application/json"))
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send a JSON body", {
      source,
    });
}
