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

/** A leave request or comp-off claim as the fake keeps it. `days` is what the real backend works out; the tests set it. */
export type FakeRequest = {
  id: string;
  employeeId: string;
  type: "Casual leave" | "Sick leave" | "Comp-off";
  status: "pending" | "approved" | "rejected" | "cancelled";
  from: string;
  to: string;
  appliedOn: string;
  halfDay?: boolean;
  cancelRequested?: boolean;
  cancelRequestedOn?: string | null;
  days: number;
  expiresOn?: string;
};

export type FakePermission = { id: string; employeeId: string; date: string; from: string; to: string; minutes: number; reason: string };

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
  /** The team's "today" (a Wednesday), like the backend's clock in ApiTest. */
  today = "2026-11-04";
  requests: FakeRequest[] = [];
  permissions: FakePermission[] = [];
  policy: Record<string, number> = { contractor: 24, employee: 24, intern: 24, student: 24 };
  /** What the backend works out for the dashboards (its engine is tested there); the fake serves these. */
  employeeDashboard = {
    year: 2026,
    applied: { approved: 3, pending: 2.5, total: 5.5 },
    compOff: { available: 1.5, waiting: 0 },
  };
  adminDashboard = {
    year: 2026, today: "2026-11-04", hour: 10, teamSize: 2, outTodayCount: 1, pendingLeaveCount: 1,
    outThisWeek: [] as unknown[], monthly: [] as { month: string; approved: number; pending: number }[],
    balances: [] as unknown[],
  };
  /** Make the next valid employee save fail with a server error. */
  failNextAdd = false;
  /** Make the next leave request fail the balance check. */
  overdrawn = false;
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
    const leaveReply = this.leaveRoutes(method, path, body, me);
    if (leaveReply) return leaveReply;
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

  private nameOf(id: string) {
    return this.users.find((u) => u.id === id)?.name ?? "Unknown";
  }

  private holidayList() {
    return [
      { name: "Republic Day", date: "2027-01-26", daysAway: 83 },
      { name: "Labour Day", date: "2027-05-01", daysAway: 178 },
      { name: "Independence Day", date: "2027-08-15", daysAway: 284 },
      { name: "Gandhi Jayanti", date: "2027-10-02", daysAway: 332 },
    ];
  }

  private requestView(r: FakeRequest) {
    const comp = r.type === "Comp-off";
    const cancel = comp ? null : r.status === "pending" ? "withdraw" : r.status === "approved" && !r.cancelRequested && r.from >= this.today ? "request" : null;
    return {
      ...r, employeeName: this.nameOf(r.employeeId), halfDay: !!r.halfDay, cancelRequested: !!r.cancelRequested,
      cancelRequestedOn: r.cancelRequestedOn ?? null, cancel,
    };
  }

  private newestFirst(list: FakeRequest[]) {
    return [...list].sort((a, b) => b.appliedOn.localeCompare(a.appliedOn) || b.from.localeCompare(a.from));
  }

  /** The leave, comp-off, permission, holiday and policy routes, with the backend's status codes and messages. */
  private leaveRoutes(method: string, path: string, body: Record<string, string>, me: FakeUser): Response | null {
    const asEmployee = me.role === "employee";
    if (path.startsWith("/api/employee/") && !asEmployee) return this.json(403, { error: "You don't have access to that." });
    if (method === "GET" && path === "/api/holidays") return this.json(200, { holidays: this.holidayList() });
    if (method === "GET" && path === "/api/employee/dashboard") return this.json(200, { ...this.employeeDashboard, holidays: this.holidayList() });
    if (method === "GET" && path === "/api/employee/leave") {
      return this.json(200, { requests: this.newestFirst(this.requests.filter((r) => r.employeeId === me.id && r.type !== "Comp-off")).map((r) => this.requestView(r)) });
    }
    if (method === "GET" && path === "/api/employee/comp-off") {
      return this.json(200, { requests: this.newestFirst(this.requests.filter((r) => r.employeeId === me.id && r.type === "Comp-off")).map((r) => this.requestView(r)) });
    }
    if (method === "POST" && path === "/api/employee/leave") {
      const errors: Record<string, string> = {};
      const half = body.dayLength === "half";
      const to = half ? body.from : body.to;
      if (!["Casual leave", "Sick leave"].includes(body.type)) errors.type = "Choose casual or sick leave.";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.from)) errors.from = "Pick a start date.";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) errors.to = "Pick an end date.";
      if (!errors.from && !errors.to && to < body.from) errors.to = "The end date can't be before the start date.";
      if (!errors.from && !errors.to && this.requests.some((r) => r.employeeId === me.id && r.type !== "Comp-off" && ["pending", "approved"].includes(r.status) && r.from <= to && r.to >= body.from)) {
        errors.form = "You already have leave that overlaps these dates.";
      }
      if (!errors.from && !errors.to && !errors.form && this.overdrawn) errors.form = "You don't have enough leave left for these dates. Ask your admin if you need more.";
      const values = { from: body.from, to: body.to };
      if (Object.keys(errors).length) return this.json(422, { errors, values });
      this.requests.push({ id: `r${this.requests.length + 1}`, employeeId: me.id, type: body.type as FakeRequest["type"], status: "pending", from: body.from, to, appliedOn: this.today, halfDay: half, days: half ? 0.5 : 1 });
      return this.json(201, { submitted: { type: body.type, from: body.from, to, halfDay: half } });
    }
    const cancel = path.match(/^\/api\/employee\/leave\/(.+)\/cancel$/);
    if (method === "POST" && cancel) {
      const r = this.requests.find((x) => x.id === cancel[1] && x.employeeId === me.id);
      if (!r) return this.json(409, { error: "We couldn't find that request." });
      if (r.status === "pending") {
        r.status = "cancelled";
        return this.json(200, { ok: true, action: "withdraw" });
      }
      if (r.status === "approved" && r.cancelRequested) return this.json(409, { error: "You've already asked to cancel this leave." });
      if (r.status === "approved" && r.from < this.today) return this.json(409, { error: "This leave has already started, so it can't be cancelled." });
      if (r.status !== "approved") return this.json(409, { error: "That request is already closed." });
      r.cancelRequested = true;
      r.cancelRequestedOn = this.today;
      return this.json(200, { ok: true, action: "request" });
    }
    if (method === "POST" && path === "/api/employee/comp-off") {
      const errors: Record<string, string> = {};
      const day = new Date(body.workedOn + "T00:00:00");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.workedOn)) errors.workedOn = "Pick the day you worked.";
      else if (body.workedOn > this.today) errors.workedOn = "That day hasn't happened yet.";
      else if (![0, 6].includes(day.getDay())) errors.workedOn = "That was a working day, so it doesn't earn comp-off. Pick a weekend or a national holiday.";
      else if (this.requests.some((r) => r.employeeId === me.id && r.type === "Comp-off" && r.status !== "rejected" && r.from === body.workedOn)) errors.workedOn = "You've already claimed comp-off for that day.";
      if (!["full", "half"].includes(body.dayLength)) errors.dayLength = "Choose a full or half day.";
      if (Object.keys(errors).length) return this.json(422, { errors, values: { workedOn: body.workedOn } });
      const half = body.dayLength === "half";
      this.requests.push({ id: `c${this.requests.length + 1}`, employeeId: me.id, type: "Comp-off", status: "pending", from: body.workedOn, to: body.workedOn, appliedOn: this.today, halfDay: half, days: half ? 0.5 : 1, expiresOn: "2027-01-05" });
      return this.json(201, { submitted: { workedOn: body.workedOn, halfDay: half } });
    }
    if (method === "GET" && path === "/api/employee/permissions") return this.json(200, { permissions: this.permissions.filter((p) => p.employeeId === me.id) });
    if (method === "POST" && path === "/api/employee/permissions") {
      const errors: Record<string, string> = {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) errors.date = "Pick the day.";
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.from)) errors.from = "Pick a start time.";
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.to)) errors.to = "Pick an end time.";
      if (!errors.from && !errors.to && body.to <= body.from) errors.to = "The end time has to be after the start time.";
      if (body.reason.length > 200) errors.reason = "Keep it under 200 characters.";
      if (!errors.date && !errors.from && !errors.to && this.permissions.some((p) => p.employeeId === me.id && p.date === body.date && p.from < body.to && p.to > body.from)) {
        errors.form = "You already have a permission that overlaps this time.";
      }
      if (Object.keys(errors).length) return this.json(422, { errors, values: { date: body.date, from: body.from, to: body.to, reason: body.reason } });
      const minutes = Number(body.to.slice(0, 2)) * 60 + Number(body.to.slice(3)) - (Number(body.from.slice(0, 2)) * 60 + Number(body.from.slice(3)));
      this.permissions.push({ id: `p${this.permissions.length + 1}`, employeeId: me.id, date: body.date, from: body.from, to: body.to, minutes, reason: body.reason.trim() });
      return this.json(201, { logged: { date: body.date, from: body.from, to: body.to } });
    }

    if (me.role !== "admin") return null;
    if (method === "GET" && path === "/api/admin/dashboard") {
      const pending = this.requests.filter((r) => r.status === "pending" || (r.status === "approved" && r.cancelRequested));
      return this.json(200, { ...this.adminDashboard, pending: pending.map((r) => this.requestView(r)), holidays: this.holidayList() });
    }
    if (method === "GET" && path === "/api/admin/leave") return this.json(200, { requests: this.newestFirst(this.requests.filter((r) => r.type !== "Comp-off")).map((r) => this.requestView(r)) });
    if (method === "GET" && path === "/api/admin/comp-off") return this.json(200, { requests: this.newestFirst(this.requests.filter((r) => r.type === "Comp-off")).map((r) => this.requestView(r)) });
    if (method === "GET" && path === "/api/admin/permissions") {
      return this.json(200, { permissions: [...this.permissions].sort((a, b) => b.date.localeCompare(a.date)).map((p) => ({ ...p, employeeName: this.nameOf(p.employeeId) })) });
    }
    const decision = path.match(/^\/api\/admin\/requests\/(.+)\/decision$/);
    if (method === "POST" && decision) {
      if (!["approved", "rejected"].includes(body.decision)) return this.json(422, { error: "Choose approve or reject." });
      const r = this.requests.find((x) => x.id === decision[1]);
      if (!r || !(r.status === "pending" || (r.status === "approved" && r.cancelRequested))) return this.json(409, { error: "That request is no longer waiting for a decision." });
      if (r.cancelRequested) {
        r.status = body.decision === "approved" ? "cancelled" : "approved";
        r.cancelRequested = false;
        r.cancelRequestedOn = null;
      } else r.status = body.decision as FakeRequest["status"];
      return this.json(200, { ok: true });
    }
    if (method === "GET" && path === "/api/admin/leave-policy") {
      return this.json(200, { categories: Object.entries(this.policy).map(([category, daysPerYear]) => ({ category, daysPerYear, employees: this.users.filter((u) => u.category === category).length })) });
    }
    if (method === "PUT" && path === "/api/admin/leave-policy") {
      const errors: Record<string, string> = {};
      const days: Record<string, number> = {};
      for (const c of Object.keys(this.policy)) {
        const raw = String(body[c] ?? "").trim();
        const n = Number(raw);
        if (raw === "" || !Number.isInteger(n)) errors[c] = "Enter a whole number of days.";
        else if (n < 0 || n > 366) errors[c] = "Use a number between 0 and 366.";
        else days[c] = n;
      }
      if (Object.keys(errors).length) return this.json(422, { errors, values: body });
      Object.assign(this.policy, days);
      return this.json(200, { saved: true });
    }
    return null;
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
