import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Returns null when valid; otherwise a localized error message. */
export function validatePasswordStrength(plain: string): string | null {
  if (typeof plain !== "string") return "Пароль должен быть строкой";
  if (plain.length < 8) return "Пароль должен быть не короче 8 символов";
  if (plain.length > 128) return "Пароль слишком длинный";
  return null;
}

/** Returns null when valid; otherwise a localized error message. */
export function validateUsername(name: string): string | null {
  if (typeof name !== "string") return "Логин должен быть строкой";
  const trimmed = name.trim();
  if (trimmed.length < 3) return "Логин должен быть не короче 3 символов";
  if (trimmed.length > 64) return "Логин слишком длинный";
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return "Логин может содержать только буквы, цифры, точку, дефис и подчёркивание";
  }
  return null;
}
