/**
 * Auth-aware fetch wrapper. Always sends cookies (credentials: "include") so
 * the HttpOnly session cookie travels with every API request. On 401, the
 * AuthContext is informed via the `onUnauthorized` callback so it can clear
 * its session state and redirect to /login.
 */
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export async function apiFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const merged: RequestInit = {
    ...init,
    credentials: "include",
    headers: {
      ...(init.headers || {}),
    },
  };
  const response = await fetch(input, merged);
  if (response.status === 401 && onUnauthorized) {
    // Defer so the caller can still read the body (it has its own clone).
    setTimeout(() => onUnauthorized?.(), 0);
  }
  return response;
}
