import type { ListParams } from './types';

const TOKEN_KEY = 'luci.token';

export const auth = {
  get token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* almacenamiento no disponible */
    }
    window.dispatchEvent(new Event('luci-auth'));
  },
};

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(describeDetail(detail) ?? `Error ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

function describeDetail(detail: unknown): string | null {
  if (!detail) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    // Errores de validación de FastAPI
    return detail
      .map((d: { loc?: (string | number)[]; msg?: string }) =>
        [d.loc?.filter((l) => l !== 'body').join('.'), d.msg].filter(Boolean).join(': '),
      )
      .join('\n');
  }
  if (typeof detail === 'object' && 'message' in detail) return String((detail as { message: string }).message);
  return JSON.stringify(detail);
}

export function toQuery(params?: ListParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = auth.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData || body instanceof URLSearchParams) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 401 && token) auth.set(null);
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* respuesta sin JSON */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, params?: ListParams) => request<T>('GET', path + toQuery(params)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),

  async login(username: string, password: string) {
    const form = new URLSearchParams({ username, password });
    const { access_token } = await request<{ access_token: string }>('POST', '/auth/login', form);
    auth.set(access_token);
  },

  async download(path: string, filename: string) {
    const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${auth.token}` } });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
