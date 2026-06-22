/**
 * File-based user store with cross-process locking.
 *
 * Layout of /app/frontend/auth/users.json:
 *   { "users": [ AuthUser, ... ] }
 *
 * AuthUser is the on-disk shape (includes passwordHash). The public-facing
 * shape returned by API endpoints is `PublicUser` (no passwordHash).
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import lockfile from "proper-lockfile";

export interface AuthUser {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin" | "user";
  isActive: boolean;
  createdAt: string;
  failedLoginAttempts: number;
  lockedUntil?: string;
  lastLoginAt?: string;
}

export type PublicUser = Omit<AuthUser, "passwordHash">;

const USERS_FILE = path.resolve(process.cwd(), "auth", "users.json");

interface UsersFile {
  users: AuthUser[];
}

async function ensureFileExists(): Promise<void> {
  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
    await fs.writeFile(USERS_FILE, JSON.stringify({ users: [] }, null, 2), "utf-8");
  }
}

async function readRaw(): Promise<UsersFile> {
  await ensureFileExists();
  const raw = await fs.readFile(USERS_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw) as UsersFile;
    if (!parsed || !Array.isArray(parsed.users)) return { users: [] };
    return parsed;
  } catch {
    return { users: [] };
  }
}

async function writeRaw(data: UsersFile): Promise<void> {
  await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/** Run a mutation with an exclusive lock so concurrent writes never corrupt the file. */
async function withLock<T>(fn: (data: UsersFile) => Promise<T> | T): Promise<T> {
  await ensureFileExists();
  const release = await lockfile.lock(USERS_FILE, {
    retries: { retries: 5, factor: 1.5, minTimeout: 50, maxTimeout: 500 },
    stale: 5000,
  });
  try {
    const data = await readRaw();
    const result = await fn(data);
    await writeRaw(data);
    return result;
  } finally {
    await release();
  }
}

export function toPublicUser(u: AuthUser): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = u;
  return rest;
}

export async function listUsers(): Promise<PublicUser[]> {
  const { users } = await readRaw();
  return users.map(toPublicUser);
}

export async function countUsers(): Promise<number> {
  const { users } = await readRaw();
  return users.length;
}

export async function findByUsername(username: string): Promise<AuthUser | undefined> {
  const { users } = await readRaw();
  const normalized = username.trim().toLowerCase();
  return users.find(u => u.username.toLowerCase() === normalized);
}

export async function findById(id: string): Promise<AuthUser | undefined> {
  const { users } = await readRaw();
  return users.find(u => u.id === id);
}

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  role: "admin" | "user";
}

export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  return withLock(async (data) => {
    const normalized = input.username.trim();
    const duplicate = data.users.find(u => u.username.toLowerCase() === normalized.toLowerCase());
    if (duplicate) throw new Error("Пользователь с таким логином уже существует");
    const newUser: AuthUser = {
      id: crypto.randomUUID(),
      username: normalized,
      passwordHash: input.passwordHash,
      role: input.role,
      isActive: true,
      createdAt: new Date().toISOString(),
      failedLoginAttempts: 0,
    };
    data.users.push(newUser);
    return toPublicUser(newUser);
  });
}

export interface UpdateUserInput {
  isActive?: boolean;
  role?: "admin" | "user";
  passwordHash?: string;
}

export async function updateUser(id: string, patch: UpdateUserInput): Promise<PublicUser> {
  return withLock(async (data) => {
    const user = data.users.find(u => u.id === id);
    if (!user) throw new Error("Пользователь не найден");
    if (patch.isActive !== undefined) user.isActive = patch.isActive;
    if (patch.role !== undefined) user.role = patch.role;
    if (patch.passwordHash !== undefined) {
      user.passwordHash = patch.passwordHash;
      user.failedLoginAttempts = 0;
      user.lockedUntil = undefined;
    }
    return toPublicUser(user);
  });
}

export async function deleteUser(id: string): Promise<void> {
  await withLock(async (data) => {
    const idx = data.users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error("Пользователь не найден");
    // Cannot delete the last active admin
    const target = data.users[idx];
    if (target.role === "admin") {
      const otherAdmins = data.users.filter(u => u.role === "admin" && u.id !== id && u.isActive);
      if (otherAdmins.length === 0) {
        throw new Error("Нельзя удалить последнего активного администратора");
      }
    }
    data.users.splice(idx, 1);
  });
}

/** Atomically record a failed login attempt and (optionally) lock the account. */
export async function recordFailedLogin(
  username: string,
  maxAttempts: number,
  lockoutDurationMs: number
): Promise<{ attempts: number; lockedUntil?: string }> {
  return withLock(async (data) => {
    const normalized = username.trim().toLowerCase();
    const user = data.users.find(u => u.username.toLowerCase() === normalized);
    if (!user) return { attempts: 0 };
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= maxAttempts) {
      user.lockedUntil = new Date(Date.now() + lockoutDurationMs).toISOString();
    }
    return { attempts: user.failedLoginAttempts, lockedUntil: user.lockedUntil };
  });
}

export async function resetFailedLogins(id: string): Promise<void> {
  await withLock(async (data) => {
    const user = data.users.find(u => u.id === id);
    if (!user) return;
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = new Date().toISOString();
  });
}

/** Returns true if the account is currently locked (lockedUntil > now). */
export function isAccountLocked(user: AuthUser): boolean {
  if (!user.lockedUntil) return false;
  return new Date(user.lockedUntil).getTime() > Date.now();
}
