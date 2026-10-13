import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

const ID = /^[A-Za-z0-9_-]{22}$/;
const MAX_AGE_MS = 180 * 24 * 60 * 60_000;

/** Parses a Cookie header; the first value wins for a repeated name. */
export function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/**
 * Identifies a browser by a random id in an HMAC-signed cookie, so each
 * browser keeps its own watchlist edits. The id is issued on the browser's
 * first edit (plain visitors get no cookie) and only server-signed ids are
 * accepted. The key lives in memory, like the edits it guards: after a
 * restart old ids no longer verify and a browser gets a new one.
 */
export function createBrowserIds(options: { secure: boolean; key?: Buffer }) {
  const key = options.key ?? randomBytes(32);
  // __Host- cookies are host-only, Secure and Path=/, so no sibling
  // subdomain can set or overwrite them. A plain name for http:// dev.
  const name = options.secure ? "__Host-msite_browser" : "msite_browser";
  const sign = (id: string) => createHmac("sha256", key).update(id).digest("base64url");

  /** The browser's verified id, or null for a browser without one. */
  const read = (request: Pick<Request, "headers">): string | null => {
    const value = readCookie(request.headers.cookie, name);
    if (!value || value.length > 100) return null;
    const [id, signature] = value.split(".");
    if (!id || !signature || !ID.test(id)) return null;
    const expected = Buffer.from(sign(id));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
  };

  /** The browser's id, issuing a new one (and its cookie) if it has none. */
  const ensure = (request: Pick<Request, "headers">, response: Response): string => {
    const known = read(request);
    if (known) return known;
    const id = randomBytes(16).toString("base64url");
    response.cookie(name, `${id}.${sign(id)}`, {
      httpOnly: true,
      secure: options.secure,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_MS,
    });
    return id;
  };

  return { name, read, ensure };
}

export type BrowserIds = ReturnType<typeof createBrowserIds>;
