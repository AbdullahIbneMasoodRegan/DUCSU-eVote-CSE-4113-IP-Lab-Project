// M1 — the one way the client talks to the server.
//
//   import { api, ApiError } from '../../app/api.js';
//   const ballot = await api.get('/ballot');            // returns the `data` field
//   await api.post('/vote', formData);                  // FormData is sent as multipart
//   try { ... } catch (e) { if (e.code === 'ALREADY_VOTED') ... }
//
// Requests are same-origin, so the HTTP-only session cookie is sent automatically.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let unauthorizedHandler = null;
/** AuthProvider registers this so an expired session logs the user out everywhere. */
export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

export async function request(path, { method = 'GET', body, signal } = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const e = json?.error ?? { code: 'HTTP_' + res.status, message: res.statusText };
    const error = new ApiError(res.status, e.code, e.message, e.details);
    if (res.status === 401 && unauthorizedHandler) unauthorizedHandler(error);
    throw error;
  }
  return json?.data;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  delete: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};

export default api;
