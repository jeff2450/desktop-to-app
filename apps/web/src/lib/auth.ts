// We now use Zustand store for memory-only access token.
// The refresh token is stored in an httpOnly cookie via /api/auth/cookie.

let _token: string | null = null;

export function setToken(token: string | null) {
  _token = token;
}

export function getToken(): string | null {
  return _token;
}

export function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function auth(req?: any): Promise<any> {
  return null;
}
