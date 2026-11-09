import { describe, expect, it } from "vitest";
import { getPageTitle, navByRole, roleLabel } from "./nav-config";

const labels = (role: "admin" | "employee") => navByRole[role].map((s) => [s.label, s.items.map((i) => i.label)]);

describe("nav config (identical to the current app's)", () => {
  it("lists the admin sections and items in order", () => {
    expect(labels("admin")).toEqual([
      ["Overview", ["Dashboard"]],
      ["Leave", ["Leave requests", "Comp-off", "Permissions"]],
      ["Company", ["Employees", "Admins", "Leave policy", "Holidays"]],
      ["Payroll", ["Payslips"]],
      ["Account", ["Change password"]],
    ]);
  });

  it("lists the employee sections and items in order", () => {
    expect(labels("employee")).toEqual([
      ["Overview", ["Dashboard"]],
      ["Requests", ["My leave", "Comp-off", "Permissions"]],
      ["Company", ["Holidays"]],
      ["Payroll", ["Payslips"]],
      ["Account", ["Change password"]],
    ]);
  });

  it("marks exactly the items the current app has not built as not ready", () => {
    const notReady = navByRole.admin.flatMap((s) => s.items).filter((i) => !i.ready).map((i) => i.label);
    expect(notReady).toEqual(["Leave requests", "Comp-off", "Holidays"]);
    expect(navByRole.employee.flatMap((s) => s.items).every((i) => i.ready)).toBe(true);
  });

  it("keeps every admin link under /admin and every employee link under /employee", () => {
    for (const role of ["admin", "employee"] as const) {
      for (const item of navByRole[role].flatMap((s) => s.items)) expect(item.href.startsWith(`/${role}`)).toBe(true);
    }
  });

  it("titles a page from the nav, and falls back to Dashboard", () => {
    expect(getPageTitle("admin", "/admin/admins")).toBe("Admins");
    expect(getPageTitle("employee", "/employee/leave")).toBe("My leave");
    expect(getPageTitle("admin", "/nowhere")).toBe("Dashboard");
  });

  it("labels the roles", () => {
    expect(roleLabel).toEqual({ admin: "Admin", employee: "Employee" });
  });
});
