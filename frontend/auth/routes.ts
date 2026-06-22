import { type Router as RouterType, type Request, type Response } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import {
  countUsers,
  createUser,
  deleteUser,
  findByUsername,
  isAccountLocked,
  listUsers,
  recordFailedLogin,
  resetFailedLogins,
  toPublicUser,
  updateUser,
  findById,
} from "./store.js";
import { hashPassword, validatePasswordStrength, validateUsername, verifyPassword } from "./passwords.js";
import { signToken, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_MS } from "./jwt.js";
import { requireAdmin, requireAuth } from "./middleware.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Tight rate limit on login to slow down brute-force attacks.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много попыток входа. Попробуйте через 15 минут." },
});

// Slightly looser limit on the one-time setup endpoint.
const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много попыток создания администратора." },
});

function setSessionCookie(res: Response, token: string): void {
  // SameSite=Lax is fine since the SPA is same-origin to the API in dev,
  // and goes through the FastAPI proxy on /api/* in the Emergent ingress.
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

interface SetupBody {
  username?: unknown;
  password?: unknown;
}

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

interface CreateUserBody {
  username?: unknown;
  password?: unknown;
  role?: unknown;
}

interface PatchUserBody {
  isActive?: unknown;
  role?: unknown;
  password?: unknown;
}

export function createAuthRouter(): RouterType {
  const router = express.Router();

  // ---------- Public endpoints ----------

  // Tell the frontend whether to show CreateInitialAdmin or Login.
  router.get("/needs-setup", async (_req: Request, res: Response) => {
    const total = await countUsers();
    res.json({ needsSetup: total === 0 });
  });

  // One-time creation of the first admin. Disabled (403) after any user exists.
  router.post("/setup", setupLimiter, async (req: Request, res: Response) => {
    try {
      const total = await countUsers();
      if (total > 0) {
        res.status(403).json({ error: "Начальная настройка уже выполнена. Используйте вход в систему." });
        return;
      }
      const body = (req.body || {}) as SetupBody;
      const username = typeof body.username === "string" ? body.username : "";
      const password = typeof body.password === "string" ? body.password : "";
      const userErr = validateUsername(username);
      if (userErr) { res.status(400).json({ error: userErr }); return; }
      const passErr = validatePasswordStrength(password);
      if (passErr) { res.status(400).json({ error: passErr }); return; }
      const passwordHash = await hashPassword(password);
      const user = await createUser({ username, passwordHash, role: "admin" });
      const token = signToken({ sub: user.id, username: user.username, role: user.role });
      setSessionCookie(res, token);
      res.json({ user, token });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Ошибка создания администратора";
      res.status(400).json({ error: message });
    }
  });

  // Login. Applies rate limiting and per-account lockout.
  router.post("/login", loginLimiter, async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as LoginBody;
      const username = typeof body.username === "string" ? body.username : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!username || !password) {
        res.status(400).json({ error: "Введите логин и пароль" });
        return;
      }
      const user = await findByUsername(username);
      if (!user) {
        // Constant-ish-time response to avoid trivial username enumeration.
        await hashPassword(password);
        res.status(401).json({ error: "Неверный логин или пароль" });
        return;
      }
      if (!user.isActive) {
        res.status(403).json({ error: "Учётная запись отключена администратором" });
        return;
      }
      if (isAccountLocked(user)) {
        const until = new Date(user.lockedUntil!).toLocaleString("ru-RU");
        res.status(423).json({ error: `Учётная запись временно заблокирована до ${until} из-за множественных неудачных попыток входа.` });
        return;
      }
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) {
        const result = await recordFailedLogin(user.username, MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MS);
        const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - result.attempts);
        if (result.lockedUntil) {
          res.status(423).json({ error: `Учётная запись заблокирована на 15 минут (превышено число попыток).` });
        } else {
          res.status(401).json({ error: `Неверный логин или пароль. Осталось попыток: ${remaining}.` });
        }
        return;
      }
      await resetFailedLogins(user.id);
      const token = signToken({ sub: user.id, username: user.username, role: user.role });
      setSessionCookie(res, token);
      res.json({ user: toPublicUser(user), token });
    } catch (err: unknown) {
      console.error("[auth] login error:", err);
      res.status(500).json({ error: "Внутренняя ошибка авторизации" });
    }
  });

  router.post("/logout", (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ success: true });
  });

  router.get("/me", requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.authUser });
  });

  // ---------- Admin-only user management ----------

  router.get("/users", requireAdmin, async (_req: Request, res: Response) => {
    const users = await listUsers();
    res.json({ users });
  });

  router.post("/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as CreateUserBody;
      const username = typeof body.username === "string" ? body.username : "";
      const password = typeof body.password === "string" ? body.password : "";
      const role = body.role === "admin" ? "admin" : "user";
      const userErr = validateUsername(username);
      if (userErr) { res.status(400).json({ error: userErr }); return; }
      const passErr = validatePasswordStrength(password);
      if (passErr) { res.status(400).json({ error: passErr }); return; }
      const passwordHash = await hashPassword(password);
      const user = await createUser({ username, passwordHash, role });
      res.json({ user });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Ошибка создания пользователя";
      res.status(400).json({ error: message });
    }
  });

  router.patch("/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const target = await findById(id);
      if (!target) { res.status(404).json({ error: "Пользователь не найден" }); return; }

      const body = (req.body || {}) as PatchUserBody;
      const patch: { isActive?: boolean; role?: "admin" | "user"; passwordHash?: string } = {};

      if (typeof body.isActive === "boolean") {
        // Prevent self-deactivation lockout for the last admin
        if (!body.isActive && target.role === "admin" && req.authUser!.id === id) {
          res.status(400).json({ error: "Нельзя отключить собственную учётную запись администратора" });
          return;
        }
        patch.isActive = body.isActive;
      }
      if (body.role === "admin" || body.role === "user") {
        // Cannot demote the last admin
        if (body.role === "user" && target.role === "admin") {
          const all = await listUsers();
          const otherActiveAdmins = all.filter(u => u.role === "admin" && u.isActive && u.id !== id);
          if (otherActiveAdmins.length === 0) {
            res.status(400).json({ error: "Нельзя понизить роль последнего активного администратора" });
            return;
          }
        }
        patch.role = body.role;
      }
      if (typeof body.password === "string" && body.password.length > 0) {
        const passErr = validatePasswordStrength(body.password);
        if (passErr) { res.status(400).json({ error: passErr }); return; }
        patch.passwordHash = await hashPassword(body.password);
      }

      const updated = await updateUser(id, patch);
      res.json({ user: updated });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Ошибка обновления пользователя";
      res.status(400).json({ error: message });
    }
  });

  router.delete("/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (req.authUser!.id === id) {
        res.status(400).json({ error: "Нельзя удалить собственную учётную запись" });
        return;
      }
      await deleteUser(id);
      res.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Ошибка удаления пользователя";
      res.status(400).json({ error: message });
    }
  });

  return router;
}
