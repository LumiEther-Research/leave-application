import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { appRoutes } from "@/routes";
import { FakeBackend } from "@/test/fake-backend";

vi.mock("sonner", async (original) => {
  const real = await original<typeof import("sonner")>();
  return { ...real, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

async function renderApp(path: string, backend: FakeBackend) {
  backend.install();
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  await act(async () => {});
  return router;
}

const asAdmin = () => new FakeBackend().signIn("priya@lumiether.test");
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

/** The desktop table (the stacked cards below md are the same data). */
const table = async () => within(await screen.findByRole("table"));
/** jsdom shows both the table and the stacked cards (the CSS that hides one is not applied), so row buttons are taken from the table. */
const inTable = async (name: string) => (await table()).getByRole("button", { name });
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

async function fill(values: Partial<Record<"Gmail address" | "Joining date" | "Designation" | "Monthly salary (₹)" | "Temporary password", string>>) {
  for (const [label, value] of Object.entries(values)) {
    const input = field(label);
    await userEvent.clear(input);
    if (value) await userEvent.type(input, value);
  }
}

describe("the employees list", () => {
  it("shows the page title and one row per employee with category, designation, salary and joining date", async () => {
    await renderApp("/admin/employees", asAdmin());
    const t = await table();
    expect(document.title).toBe("Employees · Leave Management");
    expect(screen.getByText(/^2 employees\. Each signs in with their Gmail address\./)).toBeTruthy();
    const rows = t.getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2
    expect(within(rows[1]).getByText("Asha Rao")).toBeTruthy();
    expect(within(rows[1]).getByText("AR")).toBeTruthy();
    expect(within(rows[1]).getAllByText("—")).toHaveLength(2); // no designation, no salary
    expect(within(rows[1]).getByText("5 Jan 2026")).toBeTruthy();
    expect(within(rows[2]).getByText("Designer")).toBeTruthy();
    expect(within(rows[2]).getByText("₹16,50,000.50")).toBeTruthy(); // Indian digit grouping
    expect(within(rows[2]).getByText("3 Nov 2025")).toBeTruthy();
  });

  it("shows an empty state with the same words when there are no employees", async () => {
    const backend = asAdmin();
    backend.users = backend.users.filter((u) => u.role === "admin");
    await renderApp("/admin/employees", backend);
    expect(await screen.findByText("No employees yet")).toBeTruthy();
    expect(screen.getByText("Add your first employee with the form. They can sign in as soon as you do.")).toBeTruthy();
    expect(screen.getByText(/^0 employees\./)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows an error with a retry when the list can't be loaded", async () => {
    const backend = asAdmin();
    backend.forced["/api/admin/employees"] = 500;
    await renderApp("/admin/employees", backend);
    expect(await screen.findByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("sends a signed-out visitor to /login and an employee to their own home", async () => {
    const out = await renderApp("/admin/employees", new FakeBackend());
    await waitFor(() => expect(out.state.location.pathname).toBe("/login"));
    const emp = await renderApp("/admin/employees", new FakeBackend().signIn("asha@lumiether.test"));
    await waitFor(() => expect(emp.state.location.pathname).toBe("/employee"));
  });
});

describe("adding an employee", () => {
  it("offers the four categories, with Employee chosen, and explains that the days are set under Leave policy", async () => {
    await renderApp("/admin/employees", asAdmin());
    await screen.findByRole("table");
    const select = field("Category") as unknown as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Contractor", "Employee", "Intern", "Student"]);
    expect(select.value).toBe("employee");
    expect(screen.getByText("Decides how many leave days they get. Set the days under Leave policy.")).toBeTruthy();
    expect(screen.getByText("Comp-off expires on the joining anniversary.")).toBeTruthy();
    expect(screen.getByText("At least 8 characters. Share it with them directly.")).toBeTruthy();
  });

  it("saves the employee, toasts the name derived from the email, clears the fields and updates the list", async () => {
    const backend = asAdmin();
    await renderApp("/admin/employees", backend);
    await screen.findByRole("table");
    await fill({ "Gmail address": "ravi.kumar@gmail.com", "Joining date": "2026-02-02", Designation: "Engineer", "Monthly salary (₹)": "16500.5", "Temporary password": "temp-pass-1" });
    await userEvent.selectOptions(field("Category") as unknown as HTMLSelectElement, "student");
    await userEvent.click(screen.getByRole("button", { name: "Add employee" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ravi Kumar added", { description: "ravi.kumar@gmail.com" }));
    expect(backend.callsTo("POST", "/api/admin/employees")[0].body).toEqual({
      email: "ravi.kumar@gmail.com", joiningDate: "2026-02-02", category: "student",
      monthlySalary: "16500.5", designation: "Engineer", password: "temp-pass-1",
    });
    await waitFor(async () => expect((await table()).getByText("Ravi Kumar")).toBeTruthy());
    expect(screen.getByText(/^3 employees\./)).toBeTruthy();
    expect(field("Gmail address").value).toBe("");
    expect(field("Temporary password").value).toBe("");
    expect((field("Category") as unknown as HTMLSelectElement).value).toBe("student"); // the chosen category stays
  });

  it("shows every server message under its field, keeps what was typed, and never keeps the password", async () => {
    await renderApp("/admin/employees", asAdmin());
    await screen.findByRole("table");
    await fill({ "Gmail address": "someone@yahoo.com", "Joining date": "1999-12-31", Designation: "x".repeat(101), "Monthly salary (₹)": "0", "Temporary password": "short" });
    await userEvent.click(screen.getByRole("button", { name: "Add employee" }));
    expect(await screen.findByText("Enter a Gmail address, like name@gmail.com.")).toBeTruthy();
    expect(screen.getByText("That joining date is too far back.")).toBeTruthy();
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy();
    expect(screen.getByText("Enter a positive amount with at most two decimals, like 16500 or 16500.50.")).toBeTruthy();
    expect(screen.getByText("Use at most 100 characters.")).toBeTruthy();
    expect(field("Gmail address").value).toBe("someone@yahoo.com");
    expect(field("Joining date").value).toBe("1999-12-31");
    expect(field("Temporary password").value).toBe("");
    expect(field("Gmail address").getAttribute("aria-invalid")).toBe("true");
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText(/^2 employees\./)).toBeTruthy();
  });

  it("refuses an email someone already uses, in any case", async () => {
    await renderApp("/admin/employees", asAdmin());
    await screen.findByRole("table");
    await fill({ "Gmail address": "DEV.Patel@gmail.com", "Joining date": "2026-02-02", "Temporary password": "temp-pass-1" });
    await userEvent.click(screen.getByRole("button", { name: "Add employee" }));
    expect(await screen.findByText("Someone already uses this email.")).toBeTruthy();
  });

  it("asks for a joining date when none is given", async () => {
    await renderApp("/admin/employees", asAdmin());
    await screen.findByRole("table");
    await fill({ "Gmail address": "new.person@gmail.com", "Temporary password": "temp-pass-1" });
    await userEvent.click(screen.getByRole("button", { name: "Add employee" }));
    expect(await screen.findByText("Pick a joining date.")).toBeTruthy();
  });

  it("shows a server failure as an alert above the form and keeps the fields", async () => {
    const backend = asAdmin();
    backend.failNextAdd = true;
    await renderApp("/admin/employees", backend);
    await screen.findByRole("table");
    await fill({ "Gmail address": "new.person@gmail.com", "Joining date": "2026-02-02", "Temporary password": "temp-pass-1" });
    await userEvent.click(screen.getByRole("button", { name: "Add employee" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't add the employee. Please try again.");
    expect(field("Gmail address").value).toBe("new.person@gmail.com");
  });

  it("shows 'Adding…' and blocks a second click while the request runs", async () => {
    const backend = asAdmin();
    await renderApp("/admin/employees", backend);
    await screen.findByRole("table");
    await fill({ "Gmail address": "new.person@gmail.com", "Joining date": "2026-02-02", "Temporary password": "temp-pass-1" });
    backend.hold();
    await userEvent.click(screen.getByRole("button", { name: "Add employee" }));
    const busy = await screen.findByRole("button", { name: "Adding…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    backend.release();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(backend.callsTo("POST", "/api/admin/employees")).toHaveLength(1);
  });
});

describe("changing a category", () => {
  it("saves at once, toasts in the current app's words and keeps the new value", async () => {
    const backend = asAdmin();
    await renderApp("/admin/employees", backend);
    await screen.findByRole("table");
    await userEvent.selectOptions(screen.getByLabelText("Category for Asha Rao") as unknown as HTMLSelectElement, "contractor");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Asha Rao is now a contractor"));
    expect(backend.callsTo("PATCH", "/api/admin/employees/e1/category")[0].body).toEqual({ category: "contractor" });
    expect((screen.getByLabelText("Category for Asha Rao") as HTMLSelectElement).value).toBe("contractor");
  });

  it("puts the old category back and shows the server's message when it refuses", async () => {
    const backend = asAdmin();
    await renderApp("/admin/employees", backend);
    await screen.findByRole("table");
    backend.users = backend.users.filter((u) => u.id !== "e1"); // removed in another tab
    await userEvent.selectOptions(screen.getByLabelText("Category for Asha Rao") as unknown as HTMLSelectElement, "student");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That employee no longer exists."));
    expect((screen.getByLabelText("Category for Asha Rao") as HTMLSelectElement).value).toBe("employee");
  });
});

describe("editing salary and designation", () => {
  const open = async (name: string) => {
    await userEvent.click(await inTable(`Edit salary and designation for ${name}`));
    return within(await screen.findByRole("dialog"));
  };

  it("opens with the current values, saves, toasts and shows them in the list", async () => {
    const backend = asAdmin();
    await renderApp("/admin/employees", backend);
    const dialog = await open("Asha Rao");
    expect(dialog.getByText("Payroll details for Asha Rao")).toBeTruthy();
    expect(dialog.getByText("Shown on their payslips. Leave a field empty to clear it.")).toBeTruthy();
    await userEvent.type(dialog.getByLabelText("Designation"), "Lead");
    await userEvent.type(dialog.getByLabelText("Monthly salary (₹)"), "16500");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Asha Rao's payroll details saved"));
    expect(backend.callsTo("PATCH", "/api/admin/employees/e1/payroll")[0].body).toEqual({ monthlySalary: "16500", designation: "Lead" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(async () => expect((await table()).getByText("Lead")).toBeTruthy());
    expect((await table()).getByText("₹16,500.00")).toBeTruthy();
  });

  it("shows a bad salary or a long designation under the field and keeps the dialog open", async () => {
    await renderApp("/admin/employees", asAdmin());
    const dialog = await open("Asha Rao");
    await userEvent.type(dialog.getByLabelText("Monthly salary (₹)"), "12.345");
    await userEvent.type(dialog.getByLabelText("Designation"), "x".repeat(101));
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    expect(await dialog.findByText("Enter a positive amount with at most two decimals, like 16500 or 16500.50.")).toBeTruthy();
    expect(dialog.getByText("Use at most 100 characters.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("clears both values when the fields are emptied", async () => {
    const backend = asAdmin();
    await renderApp("/admin/employees", backend);
    const dialog = await open("Dev Patel");
    expect((dialog.getByLabelText("Designation") as HTMLInputElement).value).toBe("Designer");
    expect((dialog.getByLabelText("Monthly salary (₹)") as HTMLInputElement).value).toBe("1650000.50");
    await userEvent.clear(dialog.getByLabelText("Designation"));
    await userEvent.clear(dialog.getByLabelText("Monthly salary (₹)"));
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(backend.users.find((u) => u.id === "e2")).toMatchObject({ designation: null, monthlySalary: null });
  });

  it("Cancel closes it without saving, and reopening starts from the saved values again", async () => {
    const backend = asAdmin();
    await renderApp("/admin/employees", backend);
    let dialog = await open("Dev Patel");
    await userEvent.type(dialog.getByLabelText("Designation"), " Lead");
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(backend.callsTo("PATCH", "/api/admin/employees/e2/payroll")).toHaveLength(0);
    dialog = await open("Dev Patel");
    expect((dialog.getByLabelText("Designation") as HTMLInputElement).value).toBe("Designer");
  });
});

describe("removing an employee", () => {
  it("asks first, says what goes with them, and Keep employee changes nothing", async () => {
    const backend = asAdmin();
    await renderApp("/admin/employees", backend);
    await userEvent.click(await inTable("Remove Asha Rao"));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Remove Asha Rao?")).toBeTruthy();
    expect(
      dialog.getByText(
        "asha@lumiether.test is signed out straight away and cannot sign in again. Their leave, comp-off, permissions and payslips are deleted for good. This cannot be undone.",
      ),
    ).toBeTruthy();
    await userEvent.click(dialog.getByRole("button", { name: "Keep employee" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(backend.callsTo("DELETE", "/api/admin/employees/e1")).toHaveLength(0);
    expect((await table()).getByText("Asha Rao")).toBeTruthy();
  });

  it("removes them, toasts and updates the list", async () => {
    const backend = asAdmin();
    await renderApp("/admin/employees", backend);
    await userEvent.click(await inTable("Remove Asha Rao"));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove employee" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Asha Rao was removed", { description: "asha@lumiether.test" }));
    await waitFor(() => expect(screen.queryAllByText("Asha Rao")).toHaveLength(0));
    expect(screen.getByText(/^1 employee\./)).toBeTruthy();
    expect(backend.callsTo("DELETE", "/api/admin/employees/e1")[0].credentials).toBe("include");
  });

  it("shows the server's message when they were already removed", async () => {
    const backend = asAdmin();
    await renderApp("/admin/employees", backend);
    await userEvent.click(await inTable("Remove Asha Rao"));
    backend.users = backend.users.filter((u) => u.id !== "e1");
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove employee" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That employee no longer exists."));
  });
});
