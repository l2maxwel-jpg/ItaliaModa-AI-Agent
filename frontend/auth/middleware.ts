import type { Request, Response, NextFunction } from "express";
import { verifyToken, SESSION_COOKIE_NAME, type JwtPayload } from "./jwt.js";
import { findById, type PublicUser, toPublicUser } from "./store.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: PublicUser;
    }
  }
}

/** Extract the JWT from the Authorization header (Bearer) or the session cookie. */
function extractToken(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && typeof cookies[SESSION_COOKIE_NAME] === "string") {
    return cookies[SESSION_COOKIE_NAME];
  }
  return undefined;
}

/** Verify the token and attach a PublicUser to req.authUser. Returns null when unauthenticated. */
async function resolveUserFromRequest(req: Request): Promise<PublicUser | null> {
  const token = extractToken(req);
  if (!token) return null;
  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return null;
  }
  const user = await findById(payload.sub);
  if (!user || !user.isActive) return null;
  return toPublicUser(user);
}

/** Strict middleware: returns 401 if not authenticated. Use on protected routes. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await resolveUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Требуется авторизация" });
    return;
  }
  req.authUser = user;
  next();
}

/** Strict admin-only middleware. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await resolveUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Требуется авторизация" });
    return;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Только администратор имеет доступ к этой операции" });
    return;
  }
  req.authUser = user;
  next();
}
