import jwt, { type SignOptions } from "jsonwebtoken";

const JWT_ALGORITHM = "HS256";
const TOKEN_EXPIRY_DAYS = 30;

export interface JwtPayload {
  sub: string; // user id
  username: string;
  role: "admin" | "user";
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is missing or too short. Set a 64-char hex value in /app/frontend/.env (openssl rand -hex 32).");
  }
  return secret;
}

export function signToken(payload: JwtPayload): string {
  const options: SignOptions = {
    algorithm: JWT_ALGORITHM,
    expiresIn: `${TOKEN_EXPIRY_DAYS}d`,
  };
  return jwt.sign(payload as object, getSecret(), options);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getSecret(), { algorithms: [JWT_ALGORITHM] });
  if (typeof decoded === "string" || !decoded) {
    throw new Error("Malformed token");
  }
  const p = decoded as jwt.JwtPayload & Partial<JwtPayload>;
  if (typeof p.sub !== "string" || typeof p.username !== "string" || (p.role !== "admin" && p.role !== "user")) {
    throw new Error("Token payload is invalid");
  }
  return { sub: p.sub, username: p.username, role: p.role };
}

export const SESSION_COOKIE_NAME = "italiamoda_session";
export const SESSION_COOKIE_MAX_AGE_MS = TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
