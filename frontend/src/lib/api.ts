/**
 * The only place the frontend talks to the backend. The session is the lr_session HttpOnly cookie: the browser sends it
 * because of `credentials: "include"`, and no script ever sees it, so nothing here reads or stores a token.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The parsed JSON body, or null when the reply wasn't JSON. */
    readonly body: Record<string, unknown> | null,
  ) {
    super(typeof body?.error === "string" ? body.error : `Request failed (${status})`);
  }
}

export type Reply = { status: number; body: Record<string, unknown> | null };

/** Sends the request and returns whatever the server answered, whatever the status. Throws only if the network fails. */
export async function send(method: string, path: string, body?: unknown): Promise<Reply> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    // The backend's CSRF guard requires JSON on every POST, PUT, PATCH and DELETE, even one with no body (logout, remove).
    headers: { Accept: "application/json", ...(method === "GET" && body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: Record<string, unknown> | null = null;
  try {
    const value: unknown = await res.json();
    if (value && typeof value === "object") parsed = value as Record<string, unknown>;
  } catch {
    // 204 or a non-JSON error page
  }
  return { status: res.status, body: parsed };
}

/** Like send, but anything that isn't a 2xx is thrown as an ApiError. */
export async function call(method: string, path: string, body?: unknown): Promise<Record<string, unknown> | null> {
  const reply = await send(method, path, body);
  if (reply.status < 200 || reply.status >= 300) throw new ApiError(reply.status, reply.body);
  return reply.body;
}

export type Role = "admin" | "employee";
export type SessionUser = { id: string; name: string; email: string; role: Role };
export type Admin = { id: string; name: string; email: string };

export const homeFor = (role: Role) => (role === "admin" ? "/admin" : "/employee");

/** The signed-in user, or null when there is no (valid) session. Any other failure is thrown. */
export async function currentUser(): Promise<SessionUser | null> {
  const reply = await send("GET", "/api/auth/me");
  if (reply.status === 401) return null;
  const user = (reply.body as { user?: SessionUser } | null)?.user;
  if (reply.status !== 200 || !user) throw new ApiError(reply.status, reply.body);
  return user;
}
