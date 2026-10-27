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

/**
 * POST and read the reply as server-sent events. `onEvent` gets every event
 * except the last: the stream ends with {type:'done'}, whose payload is
 * returned, or {type:'error'}, which is thrown as an ApiError. A response that
 * is not a stream (rate limiting, validation) is handled like any other error.
 */
export async function stream(path, body, { onEvent, signal, retry = true } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });

  if (res.status === 401 && retry && (await refreshSession())) {
    return stream(path, body, { onEvent, signal, retry: false });
  }

  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const err = (await parse(res))?.error ?? {};
    throw new ApiError(err.message ?? `Request failed (${res.status})`, {
      status: res.status,
      code: err.code ?? 'UNKNOWN',
      details: err.details,
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const data = buffer
        .slice(0, end)
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      buffer = buffer.slice(end + 2);
      if (!data) continue;
      const event = JSON.parse(data);
      if (event.type === 'done') return event;
      if (event.type === 'error') {
        throw new ApiError(event.message, { status: event.status, code: event.code });
      }
      onEvent?.(event);
    }
    if (done) break;
  }
  throw new ApiError('The answer was cut off on the way. Try again.', { status: 502, code: 'STREAM_CUT' });
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  delete: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};

export default api;
