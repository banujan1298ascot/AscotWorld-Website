/**
 * Shared low-level fetch for every server-backed module's client hooks
 * (batch-book, mes, ...). Every request carries an `x-staff-id` header
 * instead of a real session — see the trust-boundary note in
 * src/server/auth/requireStaff.ts. That's a demo limitation of this phase,
 * not a design choice to keep.
 */
export class ApiRequestError extends Error {}

export async function apiFetch<T>(path: string, staffId: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", "x-staff-id": staffId, ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(typeof body?.error === "string" ? body.error : `Request failed (${res.status}).`);
  }
  return body as T;
}
