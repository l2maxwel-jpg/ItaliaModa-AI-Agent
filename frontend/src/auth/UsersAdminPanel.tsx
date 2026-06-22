import React, { useCallback, useEffect, useState } from "react";
import { Users, UserPlus, Trash2, ToggleLeft, ToggleRight, KeyRound, Loader2, AlertCircle, X, CheckCircle } from "lucide-react";
import { apiFetch } from "./apiClient";
import { useAuth, type AuthUser } from "./AuthContext";

interface UsersListResponse { users?: AuthUser[]; error?: string }

async function safeJson<T extends { error?: string }>(response: Response): Promise<T> {
  try { return await response.json() as T; }
  catch { return { error: `HTTP ${response.status}` } as T; }
}

/**
 * Admin-only management panel. Rendered as a section inside the existing
 * settings drawer when the current user has role === "admin".
 */
export const UsersAdminPanel: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Create-user form state
  const [showForm, setShowForm] = useState<boolean>(false);
  const [newUsername, setNewUsername] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // Password-change modal state (per row)
  const [editingPwdUserId, setEditingPwdUserId] = useState<string | null>(null);
  const [editingPwdValue, setEditingPwdValue] = useState<string>("");
  const [isSavingPwd, setIsSavingPwd] = useState<boolean>(false);

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/auth/users");
      const data = await safeJson<UsersListResponse>(res);
      if (res.ok) {
        setUsers(data.users || []);
      } else {
        setError(data.error || "Не удалось загрузить пользователей");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Сетевая ошибка");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showFlash = (msg: string): void => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 3500);
  };

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setIsCreating(true);
    try {
      const res = await apiFetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, role: newRole }),
      });
      const data = await safeJson<{ user?: AuthUser; error?: string }>(res);
      if (res.ok && data.user) {
        setUsers((prev) => [...prev, data.user!]);
        setNewUsername(""); setNewPassword(""); setNewRole("user"); setShowForm(false);
        showFlash(`Пользователь "${data.user.username}" создан. Передайте ему логин и пароль.`);
      } else {
        setError(data.error || "Не удалось создать пользователя");
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleActive = async (u: AuthUser): Promise<void> => {
    setError(null);
    const res = await apiFetch(`/api/auth/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    const data = await safeJson<{ user?: AuthUser; error?: string }>(res);
    if (res.ok && data.user) {
      setUsers((prev) => prev.map((x) => (x.id === u.id ? data.user! : x)));
      showFlash(data.user.isActive ? `${data.user.username} активирован` : `${data.user.username} деактивирован`);
    } else {
      setError(data.error || "Не удалось обновить пользователя");
    }
  };

  const handleDelete = async (u: AuthUser): Promise<void> => {
    if (!confirm(`Удалить пользователя "${u.username}"? Это действие необратимо.`)) return;
    setError(null);
    const res = await apiFetch(`/api/auth/users/${u.id}`, { method: "DELETE" });
    const data = await safeJson<{ success?: boolean; error?: string }>(res);
    if (res.ok && data.success) {
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      showFlash(`Пользователь "${u.username}" удалён`);
    } else {
      setError(data.error || "Не удалось удалить пользователя");
    }
  };

  const handleChangePassword = async (): Promise<void> => {
    if (!editingPwdUserId) return;
    setError(null);
    setIsSavingPwd(true);
    try {
      const res = await apiFetch(`/api/auth/users/${editingPwdUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: editingPwdValue }),
      });
      const data = await safeJson<{ user?: AuthUser; error?: string }>(res);
      if (res.ok && data.user) {
        setUsers((prev) => prev.map((x) => (x.id === editingPwdUserId ? data.user! : x)));
        setEditingPwdUserId(null);
        setEditingPwdValue("");
        showFlash(`Пароль для "${data.user.username}" обновлён`);
      } else {
        setError(data.error || "Не удалось изменить пароль");
      }
    } finally {
      setIsSavingPwd(false);
    }
  };

  return (
    <div data-testid="users-admin-panel" className="border-t border-[#e1e3e5] pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-[#008060]" />
          <h3 className="text-sm font-bold text-[#202223]">Пользователи</h3>
          <span className="text-[10px] text-[#5c5f62]">({users.length})</span>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          data-testid="toggle-create-user-form-btn"
          className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#008060] hover:bg-[#006e52] text-white font-semibold shadow-sm"
        >
          <UserPlus className="w-3 h-3" />
          {showForm ? "Скрыть" : "Создать пользователя"}
        </button>
      </div>

      {actionMsg && (
        <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg bg-[#f1f8f5] border border-[#008060]/30 text-[11px] text-[#006e52]">
          <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg bg-[#fdf2f2] border border-[#fcd6d6] text-[11px] text-[#b71c1c]">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} data-testid="create-user-form" className="bg-[#fafbfb] border border-[#e1e3e5] rounded-lg p-3 mb-4 space-y-2.5">
          <div>
            <label className="block text-[10px] font-semibold text-[#5c5f62] mb-1">Логин</label>
            <input
              required
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              data-testid="new-user-username-input"
              className="w-full px-2.5 py-1.5 rounded-md border border-[#babfc3] text-xs"
              placeholder="например, anna"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-[#5c5f62] mb-1">Пароль</label>
            <input
              required
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              data-testid="new-user-password-input"
              className="w-full px-2.5 py-1.5 rounded-md border border-[#babfc3] text-xs font-mono"
              placeholder="Минимум 8 символов"
            />
            <p className="text-[10px] text-[#8c9196] mt-1">Передайте этот пароль пользователю любым безопасным способом.</p>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-[#5c5f62] mb-1">Роль</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "admin" | "user")}
              data-testid="new-user-role-select"
              className="w-full px-2.5 py-1.5 rounded-md border border-[#babfc3] text-xs bg-white"
            >
              <option value="user">Пользователь (стандартный доступ)</option>
              <option value="admin">Администратор (управление пользователями)</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={isCreating || !newUsername || !newPassword}
            data-testid="submit-create-user-btn"
            className={`w-full py-2 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 ${
              isCreating || !newUsername || !newPassword
                ? "bg-[#f1f2f4] text-[#8c9196] border border-[#e1e3e5] cursor-not-allowed"
                : "bg-[#008060] hover:bg-[#006e52] text-white shadow-sm"
            }`}
          >
            {isCreating ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
            Создать
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-[#5c5f62] py-4 justify-center">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Загрузка...</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {users.map((u) => {
            const isMe = currentUser?.id === u.id;
            const editing = editingPwdUserId === u.id;
            return (
              <div
                key={u.id}
                data-testid={`user-row-${u.username}`}
                className="flex items-center justify-between px-3 py-2 rounded-md bg-white border border-[#e1e3e5] hover:border-[#babfc3] text-xs"
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-semibold ${u.isActive ? "text-[#202223]" : "text-[#8c9196] line-through"}`}>
                      {u.username}
                    </span>
                    {u.role === "admin" && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#008060]/10 text-[#006e52] border border-[#008060]/20">
                        ADMIN
                      </span>
                    )}
                    {isMe && (
                      <span className="text-[9px] font-bold text-[#5c5f62]">(вы)</span>
                    )}
                  </div>
                  <span className="text-[9px] text-[#8c9196]">
                    Создан {new Date(u.createdAt).toLocaleDateString("ru-RU")}
                    {u.lastLoginAt && ` · вход ${new Date(u.lastLoginAt).toLocaleDateString("ru-RU")}`}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { setEditingPwdUserId(u.id); setEditingPwdValue(""); }}
                    data-testid={`change-password-btn-${u.username}`}
                    title="Сменить пароль"
                    className="p-1.5 rounded hover:bg-[#f1f2f4] text-[#5c5f62]"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(u)}
                    disabled={isMe}
                    data-testid={`toggle-active-btn-${u.username}`}
                    title={u.isActive ? "Отключить" : "Активировать"}
                    className={`p-1.5 rounded ${isMe ? "opacity-30 cursor-not-allowed" : "hover:bg-[#f1f2f4] text-[#5c5f62]"}`}
                  >
                    {u.isActive ? <ToggleRight className="w-3.5 h-3.5 text-[#008060]" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(u)}
                    disabled={isMe}
                    data-testid={`delete-user-btn-${u.username}`}
                    title="Удалить"
                    className={`p-1.5 rounded ${isMe ? "opacity-30 cursor-not-allowed" : "hover:bg-[#fdf2f2] text-[#b71c1c]"}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {editing && (
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-[#e1e3e5] rounded-lg p-4 shadow-xl z-50 w-72">
                    <div className="flex items-start justify-between mb-3">
                      <h4 className="text-xs font-bold text-[#202223]">Новый пароль для "{u.username}"</h4>
                      <button onClick={() => setEditingPwdUserId(null)} className="text-[#8c9196] hover:text-[#202223]">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <input
                      autoFocus
                      type="text"
                      value={editingPwdValue}
                      onChange={(e) => setEditingPwdValue(e.target.value)}
                      data-testid="edit-password-input"
                      className="w-full px-2.5 py-1.5 rounded-md border border-[#babfc3] text-xs font-mono mb-2"
                      placeholder="Минимум 8 символов"
                    />
                    <button
                      type="button"
                      onClick={handleChangePassword}
                      disabled={isSavingPwd || editingPwdValue.length < 8}
                      data-testid="save-password-btn"
                      className={`w-full py-1.5 rounded-md text-xs font-bold ${
                        isSavingPwd || editingPwdValue.length < 8
                          ? "bg-[#f1f2f4] text-[#8c9196] cursor-not-allowed"
                          : "bg-[#008060] hover:bg-[#006e52] text-white"
                      }`}
                    >
                      {isSavingPwd ? "Сохранение..." : "Сохранить"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
