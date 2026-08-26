/**
 * The single place the browser talks to the API.
 *
 * Everything goes through `request`, which handles: JSON encoding, credentials,
 * error normalisation, and — the interesting part — a single-flight access
 * token refresh. When a 401 comes back, the first caller triggers /auth/refresh
 * and every other in-flight request waits on that same promise instead of
 * firing its own, so a page that loads six things does not send six refreshes.
 */

const BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Field-level errors, ready to drop straight onto form inputs. */
  get fields() {
    return this.details?.fields ?? {};
  }
}

let refreshPromise = null;

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        // Clear on the next tick so concurrent callers all see the same result.
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      });
  }
  return refreshPromise;
}

async function parse(res) {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return res.ok ? null : { error: {} };
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * @param {string} path e.g. "/content" or "/auth/login"
 * @param {{method?:string, body?:any, signal?:AbortSignal, retry?:boolean, headers?:object}} opts
 */
export async function request(path, { method = 'GET', body, signal, retry = true, headers = {} } = {}) {
  const isForm = body instanceof FormData;

  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    signal,
    headers: {
      ...(isForm ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 401 on anything other than the auth endpoints themselves: try one refresh.
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request(path, { method, body, signal, retry: false, headers });
    }
  }

  const payload = await parse(res);

  if (!res.ok) {
    const err = payload?.error ?? {};
    throw new ApiError(err.message ?? `Request failed (${res.status})`, {
      status: res.status,
      code: err.code ?? 'UNKNOWN',
      details: err.details,
    });
  }

  return payload;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  delete: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};

export default api;
