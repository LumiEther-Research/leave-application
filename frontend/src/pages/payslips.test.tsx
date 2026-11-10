import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { appRoutes } from "@/routes";
import { FakeBackend, type FakePayslip } from "@/test/fake-backend";

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
const asEmployee = () => new FakeBackend().signIn("asha@lumiether.test");
const slip = (over: Partial<FakePayslip> = {}): FakePayslip => ({
  id: "s1", employeeId: "e1", periodMonth: "2026-11-01", basic: 1_650_000, deduction: 0, net: 1_650_000, generatedOn: "2026-11-02", published: true, ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

const table = async () => within(await screen.findByRole("table"));
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("the admin's payslips screen", () => {
  it("defaults to the current month and says so, with an empty state in the current app's words", async () => {
    await renderApp("/admin/payslips", asAdmin());
    expect(await screen.findByText("Payslips for November 2026")).toBeTruthy();
    expect(screen.getByText("On the 1st, drafts are made for last month at no LOP. Employees see a payslip only once it is published.")).toBeTruthy();
    expect(screen.getByText("No payslips this month")).toBeTruthy();
    expect(screen.getByText("Generate one with the form and it will show up here.")).toBeTruthy();
    expect(screen.getByText("Pick an employee and a month. The PDF is saved and can be downloaded below.")).toBeTruthy();
    expect((field("Month")).value).toBe("2026-11");
  });

  it("lists the month's payslips with money, who made them and a download link", async () => {
    const backend = asAdmin();
    backend.payslips = [slip({ deduction: 150_050, net: 1_499_950 }), slip({ id: "s2", employeeId: "e2", periodMonth: "2026-10-01" })];
    await renderApp("/admin/payslips", backend);
    const rows = (await table()).getAllByRole("row");
    expect(rows).toHaveLength(2); // header + this month's one
    expect(within(rows[1]).getByText("Asha Rao")).toBeTruthy();
    expect(within(rows[1]).getByText("HR-EMP-00003")).toBeTruthy();
    expect(within(rows[1]).getByText("November 2026")).toBeTruthy();
    expect(within(rows[1]).getByText("₹16,500.00")).toBeTruthy();
    expect(within(rows[1]).getByText("₹1,500.50")).toBeTruthy();
    expect(within(rows[1]).getByText("₹14,999.50")).toBeTruthy();
    expect(within(rows[1]).getByText("2 Nov 2026")).toBeTruthy();
    expect(within(rows[1]).getByText("Published")).toBeTruthy();
    const link = within(rows[1]).getByRole("link", { name: "Download November 2026 payslip for Asha Rao" });
    expect(link.getAttribute("href")).toBe("/api/payslips/s1/pdf");
    expect(link.hasAttribute("download")).toBe(true);
    expect(within(rows[1]).queryByRole("button", { name: /Publish/ })).toBeNull(); // already visible to the employee
  });

  it("follows ?month= in the address", async () => {
    const backend = asAdmin();
    backend.payslips = [slip({ id: "s2", periodMonth: "2026-10-01" })];
    await renderApp("/admin/payslips?month=2026-10", backend);
    expect(await screen.findByText("Payslips for October 2026")).toBeTruthy();
    expect((await table()).getByText("October 2026")).toBeTruthy();
  });

  it("changing the month reloads the list without losing the chosen employee", async () => {
    const backend = asAdmin();
    backend.payslips = [slip({ id: "s2", periodMonth: "2026-10-01", employeeId: "e2" })];
    await renderApp("/admin/payslips", backend);
    await screen.findByText("No payslips this month");
    await userEvent.selectOptions(field("Employee") as unknown as HTMLSelectElement, "e1");
    const month = field("Month");
    await userEvent.clear(month);
    await userEvent.type(month, "2026-10");
    expect(await screen.findByText("Payslips for October 2026")).toBeTruthy();
    expect((await table()).getByText("Dev Patel")).toBeTruthy();
    expect((field("Employee") as unknown as HTMLSelectElement).value).toBe("e1");
  });

  it("marks a draft and publishes it with one click", async () => {
    const backend = asAdmin();
    backend.payslips = [slip({ published: false })];
    await renderApp("/admin/payslips", backend);
    expect((await table()).getByText("Draft")).toBeTruthy();
    await userEvent.click((await table()).getByRole("button", { name: "Publish November 2026 payslip for Asha Rao" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("November 2026 payslip published for Asha Rao"));
    expect(backend.payslips[0].published).toBe(true);
    await waitFor(async () => expect((await table()).getByText("Published")).toBeTruthy());
    expect((await table()).queryByRole("button", { name: /Publish/ })).toBeNull();
  });

  it("shows the server's message when the draft was already published", async () => {
    const backend = asAdmin();
    backend.payslips = [slip({ published: false })];
    await renderApp("/admin/payslips", backend);
    const button = (await table()).getByRole("button", { name: "Publish November 2026 payslip for Asha Rao" });
    backend.payslips[0].published = true;
    await userEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That payslip is already published or no longer exists."));
  });

  it("keeps employees out", async () => {
    const router = await renderApp("/admin/payslips", asEmployee());
    await waitFor(() => expect(router.state.location.pathname).toBe("/employee"));
  });
});

describe("generating a payslip", () => {
  const open = async (backend = asAdmin()) => {
    await renderApp("/admin/payslips", backend);
    await screen.findByText("Generate a payslip");
    return backend;
  };
  const pick = (id: string) => userEvent.selectOptions(field("Employee") as unknown as HTMLSelectElement, id);

  it("starts with the basic at their monthly salary and shows their code and designation", async () => {
    const backend = asAdmin();
    backend.users.find((u) => u.id === "e2")!.monthlySalary = "16500.00";
    await open(backend);
    expect(Array.from((field("Employee") as unknown as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      "Choose an employee", "Asha Rao (HR-EMP-00003)", "Dev Patel (HR-EMP-00004)",
    ]);
    await pick("e2");
    expect(field("Basic (₹)").value).toBe("16500.00");
    expect(screen.getByText("HR-EMP-00004")).toBeTruthy();
    expect(screen.getByText("Designer")).toBeTruthy();
    expect(screen.getByText("Starts at their monthly salary.")).toBeTruthy();
    expect(screen.getByText("₹16,500.00")).toBeTruthy(); // the live net pay
  });

  it("says when they have no salary or designation set", async () => {
    await open();
    await pick("e1");
    expect(field("Basic (₹)").value).toBe("");
    expect(screen.getByText("No monthly salary is set for them. Type the basic.")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
  });

  it("shows the net pay as you type the deduction and warns about a deduction above the basic, before sending", async () => {
    const backend = await open();
    await pick("e1");
    await userEvent.type(field("Basic (₹)"), "16500");
    expect(screen.getByText("₹16,500.00")).toBeTruthy();
    await userEvent.type(field("Deduction (₹)"), "1500.50");
    expect(screen.getByText("₹14,999.50")).toBeTruthy();
    await userEvent.clear(field("Deduction (₹)"));
    await userEvent.type(field("Deduction (₹)"), "16500.01");
    expect(screen.getByText("Deduction can't be more than the basic of ₹16,500.00.")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Generate payslip" }) as HTMLButtonElement).disabled).toBe(true);
    expect(backend.callsTo("POST", "/api/admin/payslips")).toHaveLength(0);
  });

  it("explains that the deduction is loss of pay and may be left empty", async () => {
    await open();
    expect(screen.getByText("Loss of pay. Leave empty for none.")).toBeTruthy();
  });

  it("is disabled until an employee, a month and a valid amount are given", async () => {
    await open();
    const button = screen.getByRole("button", { name: "Generate payslip" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await pick("e1");
    expect(button.disabled).toBe(true);
    await userEvent.type(field("Basic (₹)"), "16500");
    expect(button.disabled).toBe(false);
  });

  it("generates the payslip, toasts, and lists it as published for the month", async () => {
    const backend = await open();
    await pick("e1");
    await userEvent.type(field("Basic (₹)"), "16500");
    await userEvent.type(field("Deduction (₹)"), "1500.5");
    await userEvent.click(screen.getByRole("button", { name: "Generate payslip" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Payslip generated for Asha Rao, November 2026"));
    expect(backend.callsTo("POST", "/api/admin/payslips")[0].body).toEqual({ employeeId: "e1", month: "2026-11", basic: "16500", deduction: "1500.5", replace: false });
    const row = (await table()).getAllByRole("row")[1];
    expect(within(row).getByText("₹14,999.50")).toBeTruthy();
    expect(within(row).getByText("Published")).toBeTruthy();
  });

  it("shows the server's messages under the fields and saves nothing", async () => {
    const backend = await open();
    await pick("e1");
    await userEvent.type(field("Basic (₹)"), "16500");
    await userEvent.clear(field("Month"));
    await userEvent.type(field("Month"), "1999-12");
    await userEvent.click(screen.getByRole("button", { name: "Generate payslip" }));
    expect(await screen.findByText("Choose a month.")).toBeTruthy();
    expect(backend.payslips).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("asks before replacing a published payslip, and Cancel leaves it untouched", async () => {
    const backend = asAdmin();
    backend.payslips = [slip()];
    await open(backend);
    await pick("e1");
    await userEvent.type(field("Basic (₹)"), "16500");
    await userEvent.type(field("Deduction (₹)"), "500");
    await userEvent.click(screen.getByRole("button", { name: "Generate payslip" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Replace this payslip?")).toBeTruthy();
    expect(dialog.getByText("Asha Rao already has a payslip for November 2026. Generating again replaces it.")).toBeTruthy();
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(backend.payslips[0].deduction).toBe(0);
    expect(backend.callsTo("POST", "/api/admin/payslips")).toHaveLength(1); // nothing sent again
  });

  it("replaces it only after 'Replace payslip', and says replaced", async () => {
    const backend = asAdmin();
    backend.payslips = [slip()];
    await open(backend);
    await pick("e1");
    await userEvent.type(field("Basic (₹)"), "16500");
    await userEvent.type(field("Deduction (₹)"), "500");
    await userEvent.click(screen.getByRole("button", { name: "Generate payslip" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Replace payslip" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Payslip replaced for Asha Rao, November 2026"));
    expect(backend.callsTo("POST", "/api/admin/payslips")[1].body).toMatchObject({ replace: true });
    expect(backend.payslips).toHaveLength(1);
    expect(backend.payslips[0].deduction).toBe(50_000);
  });

  it("a draft is replaced without asking, and published", async () => {
    const backend = asAdmin();
    backend.payslips = [slip({ published: false })];
    await open(backend);
    await pick("e1");
    await userEvent.type(field("Basic (₹)"), "16500");
    await userEvent.click(screen.getByRole("button", { name: "Generate payslip" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Payslip replaced for Asha Rao, November 2026"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when the PDF service is down, that nothing was saved, and how to start it", async () => {
    const backend = asAdmin();
    backend.pdfDown = true;
    await open(backend);
    await pick("e1");
    await userEvent.type(field("Basic (₹)"), "16500");
    await userEvent.click(screen.getByRole("button", { name: "Generate payslip" }));
    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert).toContain("PDF service is not running. Nothing was saved.");
    expect(alert).toContain("Start it with docker compose up pdf, then try again.");
    expect(toast.error).toHaveBeenCalledWith("PDF service is not running");
    expect(backend.payslips).toHaveLength(0);
  });

  it("shows 'Generating…' and blocks a second click while it runs", async () => {
    const backend = await open();
    await pick("e1");
    await userEvent.type(field("Basic (₹)"), "16500");
    backend.hold();
    await userEvent.click(screen.getByRole("button", { name: "Generate payslip" }));
    expect(((await screen.findByRole("button", { name: "Generating…" })) as HTMLButtonElement).disabled).toBe(true);
    backend.release();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(backend.callsTo("POST", "/api/admin/payslips")).toHaveLength(1);
  });
});

describe("the employee's payslips screen", () => {
  it("shows an empty state in the current app's words", async () => {
    await renderApp("/employee/payslips", asEmployee());
    expect(await screen.findByText("No payslips yet")).toBeTruthy();
    expect(screen.getByText("Your payslips will show up here once your admin generates them.")).toBeTruthy();
  });

  it("lists only their own published payslips, newest first, with no employee column, status or publish button", async () => {
    const backend = asEmployee();
    backend.payslips = [
      slip({ id: "s1", periodMonth: "2026-09-01" }),
      slip({ id: "s2", periodMonth: "2026-10-01", deduction: 100_000, net: 1_550_000 }),
      slip({ id: "s3", periodMonth: "2026-11-01", published: false }), // a draft: not theirs to see yet
      slip({ id: "s4", employeeId: "e2", periodMonth: "2026-10-01" }), // someone else's
    ];
    await renderApp("/employee/payslips", backend);
    expect(await screen.findByText("Your payslips")).toBeTruthy();
    expect(screen.getByText("Download a payslip for any month it has been generated.")).toBeTruthy();
    const t = await table();
    const rows = t.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("October 2026")).toBeTruthy();
    expect(within(rows[1]).getByText("₹15,500.00")).toBeTruthy();
    expect(within(rows[2]).getByText("September 2026")).toBeTruthy();
    expect(t.queryByText("Employee")).toBeNull();
    expect(t.queryByText("Status")).toBeNull();
    expect(t.queryByText("Draft")).toBeNull();
    expect(t.queryByRole("button", { name: /Publish/ })).toBeNull();
    expect(within(rows[1]).getByRole("link", { name: "Download October 2026 payslip for Asha Rao" }).getAttribute("href")).toBe("/api/payslips/s2/pdf");
  });

  it("keeps an admin out", async () => {
    const router = await renderApp("/employee/payslips", asAdmin());
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin"));
  });
});
