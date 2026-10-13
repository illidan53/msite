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
 * Gate for owner-only writes: the research IP allowlist plus
 * assertSameSiteWrite. The IP gate alone lets any page the owner visits post
 * through their browser (CSRF).
 */
export function assertOwnerWrite(
  access: ReturnType<typeof researchAccess>,
  req: Request,
  options: { source: string; forbidden: string; requireJson?: boolean },
) {
  if (!access(req).canRun)
    throw new ApiError(403, "RESEARCH_IP_FORBIDDEN", options.forbidden, {
      source: options.source,
    });
  assertSameSiteWrite(req, options);
}

/**
 * Refuses writes from other sites and, for methods a cross-site form could
 * send, requires a JSON body, which forces a CORS preflight. DELETE is never
 * a CORS-simple method, so it is always preflighted and passes
 * `requireJson: false`. Sibling *.nphunter.net apps are "same-site", so only
 * "same-origin" passes Sec-Fetch-Site.
 */
export function assertSameSiteWrite(
  req: Request,
  options: { source: string; requireJson?: boolean },
) {
  const { source } = options;
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  if (
    (fetchSite !== undefined && fetchSite !== "same-origin") ||
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
