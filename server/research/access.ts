import { isIP } from "node:net";
import type { Request } from "express";

export interface ResearchAccessOptions {
  allowedIps: string[];
  trustedProxyIps: string[];
}

// No subnet/range matching: only explicitly configured host addresses are trusted.
// In production the sole peer is the Docker bridge gateway used by host Caddy.
export function normalizeIp(value: string | undefined): string | null {
  if (!value) return null;
  const ip = value.trim().toLowerCase();
  const normalized =
    ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  return isIP(normalized) ? normalized : null;
}

export function parseIps(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((entry) => {
    const ip = normalizeIp(entry);
    if (!ip)
      throw new Error(
        "Research IP configuration must contain exact IP addresses",
      );
    return ip;
  });
}

export function researchAccess(options: ResearchAccessOptions) {
  const allowed = new Set(parseIps(options.allowedIps.join(",")));
  const proxies = new Set(parseIps(options.trustedProxyIps.join(",")));
  return (request: Pick<Request, "socket" | "headers">) => {
    const peer = normalizeIp(request.socket.remoteAddress);
    let clientIp = peer;
    if (peer && proxies.has(peer)) {
      // Caddy replaces incoming X-Forwarded-For by default. Require one address;
      // never accept a client-selected element from a multi-hop header chain.
      const forwarded = request.headers["x-forwarded-for"];
      clientIp =
        typeof forwarded === "string" && !forwarded.includes(",")
          ? normalizeIp(forwarded)
          : null;
    }
    return { canRun: clientIp !== null && allowed.has(clientIp), clientIp };
  };
}
