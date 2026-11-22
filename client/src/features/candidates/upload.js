// M3 — upload a JPEG/PNG as a raw request body (PUT, Content-Type = the file's type).
// The shared api client sends JSON or FormData only, so images use this small helper;
// errors come back as the same ApiError the rest of the app handles.
import { ApiError } from '../../app/api.js';

export async function uploadImage(path, file) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type },
      body: file,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const e = json?.error ?? { code: `HTTP_${res.status}`, message: res.statusText };
    throw new ApiError(res.status, e.code, e.message, e.details);
  }
  return json?.data;
}
