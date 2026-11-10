import { vi } from "vitest";

/**
 * A stand-in for the Helidon backend, with the same routes, status codes and messages as backend/.../web/Api.java,
 * Employees.java, ChangePassword.java and Store.java. It lets the screens be tested without a server. The rules
 * themselves (last admin, no self-removal, password checks) are tested against the real backend in backend/src/test.
 */
export type FakeUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "employee";
  password: string;
  /** employees only */
  category?: string;
  joiningDate?: string;
  designation?: string | null;
  monthlySalary?: string | null;
};
export type Call = { method: string; path: string; credentials?: RequestCredentials; headers: Record<string, string>; body: unknown };

export const FAILED = "Incorrect email or password.";

export class FakeBackend {
  users: FakeUser[] = [
    { id: "a1", name: "Priya Sharma", email: "priya@lumiether.test", role: "admin", password: "correct-horse" },
    { id: "a2", name: "Ravi Kumar", email: "ravi@lumiether.test", role: "admin", password: "battery-staple" },
    {
      id: "e1", name: "Asha Rao", email: "asha@lumiether.test", role: "employee", password: "employee-pass",
      category: "employee", joiningDate: "2026-01-05", designation: null, monthlySalary: null,
    },
    {
      id: "e2", name: "Dev Patel", email: "dev.patel@gmail.com", role: "employee", password: "employee-pass",
      category: "intern", joiningDate: "2025-11-03", designation: "Designer", monthlySalary: "1650000.50",
    },
  ];
  /** Who the (HttpOnly) cookie belongs to. The page never sees this. */
  signedInAs: string | null = null;
  calls: Call[] = [];
  /** Make the next request(s) to a path fail the way a dead server would. */
  down = false;
  /** A fixed status for one path, e.g. { "/api/admin/admins": 500 } */
  forced: Record<string, number> = {};
  /** Make the backend refuse removing anyone with this message (a race the page can't see coming). */
  removalRefusal: string | null = null;
  /** Make the next valid employee save fail with a server error. */
  failNextAdd = false;
  /** Hold every reply until release() is called, to look at the page while a request is running. */
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;

  signIn(email: string) {
    this.signedInAs = this.users.find((u) => u.email === email)?.id ?? null;
    return this;
  }
  hold() {
    this.gate = new Promise((r) => (this.open = r));
  }
  release() {
    this.open?.();
    this.gate = null;
  }
  get me() {
    return this.users.find((u) => u.id === this.signedInAs);
  }
  callsTo(method: string, path: string) {
    return this.calls.filter((c) => c.method === method && c.path === path);
  }

  install() {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => this.handle(String(input), init ?? {}));
    return this;
  }

  private json(status: number, body?: unknown) {
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  private async handle(path: string, init: RequestInit): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    this.calls.push({ method, path, credentials: init.credentials, headers: (init.headers ?? {}) as Record<string, string>, body });
    if (this.gate) await this.gate;
    // Same as CsrfGuard.java: state-changing requests must be JSON, with or without a body.
    if (method !== "GET" && method !== "HEAD" && (init.headers as Record<string, string> | undefined)?.["Content-Type"] !== "application/json") {
      return this.json(415, { error: "Requests must be sent as JSON." });
    }
    if (this.down) throw new TypeError("Failed to fetch");
    if (this.forced[path]) return this.json(this.forced[path], { error: "Something went wrong. Please try again." });

    if (method === "POST" && path === "/api/auth/login") {
      const user = this.users.find((u) => u.email === String(body.email).trim().toLowerCase());
      if (!body.email?.trim() || !body.password || !user || user.password !== body.password) return this.json(401, { error: FAILED });
      this.signedInAs = user.id;
      return this.json(200, { user: this.view(user) });
    }
    if (method === "POST" && path === "/api/auth/logout") {
      this.signedInAs = null;
      return this.json(204);
    }
    const me = this.me;
    if (!me) return this.json(401, { error: "You are signed out. Sign in again." });
    if (method === "GET" && path === "/api/auth/me") return this.json(200, { user: this.view(me) });

    if (method === "POST" && path === "/api/account/password") {
      const errors: Record<string, string> = {};
      if (!body.current) errors.current = "Enter your current password.";
      if (body.next.length < 8) errors.next = "Use at least 8 characters.";
      else if (body.next.length > 128) errors.next = "Use at most 128 characters.";
      else if (body.next === body.current) errors.next = "Choose a password you aren't already using.";
      if (!errors.next && body.confirm !== body.next) errors.confirm = "The two new passwords don't match.";
      if (body.current && body.current !== me.password) errors.current = "That isn't your current password.";
      if (Object.keys(errors).length) return this.json(422, { errors });
      me.password = body.next;
      return this.json(200, { ok: true });
    }

    if (me.role !== "admin" && path.startsWith("/api/admin/")) return this.json(403, { error: "You don't have access to that." });
    if (method === "GET" && path === "/api/admin/admins") {
      return this.json(200, { admins: this.users.filter((u) => u.role === "admin").map(({ id, name, email }) => ({ id, name, email })) });
    }
    if (method === "POST" && path === "/api/admin/admins") {
      const email = String(body.email).trim().toLowerCase();
      const errors: Record<string, string> = {};
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = "Enter a valid email address.";
      else if (this.users.some((u) => u.email === email)) errors.email = "Someone already uses this email.";
      if (body.password.length < 8) errors.password = "Use at least 8 characters.";
      if (Object.keys(errors).length) return this.json(422, { errors, values: { email: body.email } });
      const name = email.split("@")[0].split(/[._+-]+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
      this.users.push({ id: `a${this.users.length + 1}`, name, email, role: "admin", password: body.password });
      return this.json(201, { created: { name, email } });
    }
    if (method === "GET" && path === "/api/admin/employees") {
      return this.json(200, { employees: this.users.filter((u) => u.role === "employee").map((u) => this.employeeRow(u)) });
    }
    if (method === "POST" && path === "/api/admin/employees") return this.addEmployee(body);
    const cat = path.match(/^\/api\/admin\/employees\/(.+)\/category$/);
    if (method === "PATCH" && cat) {
      if (!["contractor", "employee", "intern", "student"].includes(body.category)) return this.json(422, { error: "Choose a category." });
      const target = this.employee(cat[1]);
      if (!target) return this.json(404, { error: "That employee no longer exists." });
      target.category = body.category;
      return this.json(200, { ok: true });
    }
    const pay = path.match(/^\/api\/admin\/employees\/(.+)\/payroll$/);
    if (method === "PATCH" && pay) {
      const errors = this.payrollErrors(body.monthlySalary, body.designation);
      if (Object.keys(errors).length) return this.json(422, { errors });
      const target = this.employee(pay[1]);
      if (!target) return this.json(404, { error: "That employee no longer exists." });
      target.monthlySalary = body.monthlySalary.trim() ? Number(body.monthlySalary.trim().replace(/,/g, "")).toFixed(2) : null;
      target.designation = body.designation.trim() || null;
      return this.json(200, { ok: true });
    }
    const delEmployee = path.match(/^\/api\/admin\/employees\/(.+)$/);
    if (method === "DELETE" && delEmployee) {
      if (!this.employee(delEmployee[1])) return this.json(404, { error: "That employee no longer exists." });
      this.users = this.users.filter((u) => u.id !== delEmployee[1]);
      return this.json(200, { ok: true });
    }
    const del = path.match(/^\/api\/admin\/admins\/(.+)$/);
    if (method === "DELETE" && del) {
      const id = decodeURIComponent(del[1]);
      if (this.removalRefusal) return this.json(409, { error: this.removalRefusal });
      if (id === me.id) return this.json(409, { error: "You can't remove your own admin account." });
      if (!this.users.some((u) => u.id === id && u.role === "admin")) return this.json(409, { error: "That admin no longer exists." });
      if (this.users.filter((u) => u.role === "admin").length <= 1) return this.json(409, { error: "There has to be at least one admin." });
      this.users = this.users.filter((u) => u.id !== id);
      return this.json(200, { ok: true });
    }
    return this.json(404, { error: "Not found" });
  }

  private employee(id: string) {
    return this.users.find((u) => u.id === decodeURIComponent(id) && u.role === "employee");
  }

  private employeeRow(u: FakeUser) {
    return {
      id: u.id, name: u.name, email: u.email, category: u.category, joiningDate: u.joiningDate,
      designation: u.designation ?? null, monthlySalary: u.monthlySalary ?? null,
    };
  }

  /** The same messages as Employees.validatePayroll in the backend. */
  private payrollErrors(salary: string, designation: string) {
    const errors: Record<string, string> = {};
    const text = salary.trim().replace(/,/g, "");
    if (text && (!/^\d{1,10}(\.\d{1,2})?$/.test(text) || Number(text) <= 0)) {
      errors.monthlySalary = "Enter a positive amount with at most two decimals, like 16500 or 16500.50.";
    }
    if (designation.trim().length > 100) errors.designation = "Use at most 100 characters.";
    return errors;
  }

  /** The same messages and order as Employees.validateNewEmployee in the backend. */
  private addEmployee(body: Record<string, string>) {
    const errors: Record<string, string> = {};
    const email = body.email.trim().toLowerCase();
    if (!["contractor", "employee", "intern", "student"].includes(body.category)) errors.category = "Choose a category.";
    if (!/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@gmail\.com$/.test(email)) errors.email = "Enter a Gmail address, like name@gmail.com.";
    else if (this.users.some((u) => u.email.toLowerCase() === email)) errors.email = "Someone already uses this email.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.joiningDate.trim())) errors.joiningDate = "Pick a joining date.";
    else if (body.joiningDate.trim() < "2000-01-01") errors.joiningDate = "That joining date is too far back.";
    if (body.password.length < 8) errors.password = "Use at least 8 characters.";
    else if (body.password.length > 128) errors.password = "Use at most 128 characters.";
    Object.assign(errors, this.payrollErrors(body.monthlySalary, body.designation));
    const values = { email: body.email, joiningDate: body.joiningDate, category: body.category, monthlySalary: body.monthlySalary, designation: body.designation };
    if (Object.keys(errors).length) return this.json(422, { errors, values });
    if (this.failNextAdd) return this.json(500, { error: "Couldn't add the employee. Please try again.", values });
    const name = email.split("@")[0].replace(/\d+/g, " ").split(/[._+-]+|\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    this.users.push({
      id: `e${this.users.length + 1}`, name, email, role: "employee", password: body.password, category: body.category,
      joiningDate: body.joiningDate.trim(), designation: body.designation.trim() || null,
      monthlySalary: body.monthlySalary.trim() ? Number(body.monthlySalary.trim().replace(/,/g, "")).toFixed(2) : null,
    });
    return this.json(201, { created: { name, email } });
  }

  private view({ id, name, email, role }: FakeUser) {
    return { id, name, email, role };
  }
}
