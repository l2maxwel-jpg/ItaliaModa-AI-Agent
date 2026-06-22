import React, { useState } from "react";
import { Lock, AlertCircle, Loader2, ShieldCheck, UserPlus } from "lucide-react";
import { useAuth } from "./AuthContext";

interface AuthGateScreenProps {
  mode: "login" | "setup";
}

/**
 * Single component for both first-run admin setup and regular login.
 * Distinguished by `mode`; only header copy + button label differ.
 */
export const AuthGateScreen: React.FC<AuthGateScreenProps> = ({ mode }) => {
  const { login, setupAdmin } = useAuth();
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const isSetup = mode === "setup";

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (isSetup && password !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    const result = isSetup
      ? await setupAdmin(username.trim(), password)
      : await login(username.trim(), password);
    setBusy(false);
    if (!result.ok) {
      setError((result as { ok: false; error: string }).error);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#fafbfb] px-4">
      <form
        onSubmit={handleSubmit}
        data-testid={isSetup ? "setup-form" : "login-form"}
        className="w-full max-w-sm bg-white border border-[#e1e3e5] rounded-2xl shadow-sm p-7"
      >
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#008060] flex items-center justify-center mb-3 shadow-sm">
            {isSetup ? <UserPlus className="w-6 h-6 text-white" /> : <ShieldCheck className="w-6 h-6 text-white" />}
          </div>
          <h1 className="text-lg font-bold text-[#202223]" data-testid="auth-title">
            {isSetup ? "Создайте учётную запись администратора" : "ItaliaModa AI Agent"}
          </h1>
          <p className="text-xs text-[#5c5f62] mt-1 text-center">
            {isSetup
              ? "Это первый запуск приложения. Создайте свой логин и пароль, чтобы начать работу."
              : "Войдите, чтобы получить доступ к панели публикации."}
          </p>
        </div>

        {error && (
          <div
            data-testid="auth-error"
            className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-[#fdf2f2] border border-[#fcd6d6] text-[11px] text-[#b71c1c]"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <label className="block text-[11px] font-semibold text-[#5c5f62] mb-1.5">Логин</label>
        <input
          autoFocus
          autoComplete="username"
          required
          data-testid="auth-username-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full mb-3 px-3 py-2.5 rounded-lg border border-[#babfc3] focus:border-[#008060] focus:outline-none text-sm text-[#202223]"
          placeholder="например, admin"
        />

        <label className="block text-[11px] font-semibold text-[#5c5f62] mb-1.5">Пароль</label>
        <input
          type="password"
          autoComplete={isSetup ? "new-password" : "current-password"}
          required
          data-testid="auth-password-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-3 px-3 py-2.5 rounded-lg border border-[#babfc3] focus:border-[#008060] focus:outline-none text-sm text-[#202223]"
          placeholder={isSetup ? "Минимум 8 символов" : "Ваш пароль"}
        />

        {isSetup && (
          <>
            <label className="block text-[11px] font-semibold text-[#5c5f62] mb-1.5">Повторите пароль</label>
            <input
              type="password"
              autoComplete="new-password"
              required
              data-testid="auth-confirm-password-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full mb-3 px-3 py-2.5 rounded-lg border border-[#babfc3] focus:border-[#008060] focus:outline-none text-sm text-[#202223]"
              placeholder="Введите пароль ещё раз"
            />
          </>
        )}

        <button
          type="submit"
          disabled={busy || !username || !password || (isSetup && !confirmPassword)}
          data-testid="auth-submit-btn"
          className={`w-full mt-2 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${
            busy || !username || !password
              ? "bg-[#f1f2f4] text-[#8c9196] border border-[#e1e3e5] cursor-not-allowed"
              : "bg-[#008060] hover:bg-[#006e52] active:bg-[#005e46] text-white shadow-sm"
          }`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
          <span>{isSetup ? "Создать администратора" : "Войти"}</span>
        </button>

        {!isSetup && (
          <p className="text-[10px] text-[#8c9196] mt-4 text-center">
            Доступ выдаёт администратор. Регистрация недоступна.
          </p>
        )}
      </form>
    </div>
  );
};
