import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { appRoutes } from "@/routes";
import { FakeBackend, type FakeRequest } from "@/test/fake-backend";

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
const leave = (over: Partial<FakeRequest>): FakeRequest => ({
  id: "r1", employeeId: "e1", type: "Casual leave", status: "pending", from: "2026-11-16", to: "2026-11-18", appliedOn: "2026-11-02", days: 3, ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const select = (label: string) => screen.getByLabelText(label) as unknown as HTMLSelectElement;
/** jsdom shows both the table and the stacked cards, so row buttons are taken from the table. */
const inTable = async () => within(await screen.findByRole("table"));

// ============================================================== employee side

describe("the employee dashboard", () => {
  it("shows the days applied for and the comp-off, and never an allowance or a remaining balance", async () => {
    await renderApp("/employee", asEmployee());
    expect(await screen.findByText("Leave applied")).toBeTruthy();
    expect(screen.getByText("5.5 days")).toBeTruthy();
    expect(screen.getByText("3 approved · 2.5 waiting for approval")).toBeTruthy();
    expect(screen.getByText("1.5 days")).toBeTruthy();
    expect(screen.getByText("Approved and ready to use")).toBeTruthy();
    expect(screen.getByText("Leave you've applied for in 2026, and your comp-off.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/remaining|allowance|per year|a year/i);
  });

  it("says how much comp-off is still waiting for approval", async () => {
    const backend = asEmployee();
    backend.employeeDashboard.compOff = { available: 0, waiting: 1 };
    await renderApp("/employee", backend);
    expect(await screen.findByText("1 more waiting for approval")).toBeTruthy();
  });

  it("lists the upcoming holidays, soonest first, marking the next one", async () => {
    await renderApp("/employee", asEmployee());
    expect(await screen.findByText("Upcoming holidays")).toBeTruthy();
    expect(screen.getByText("Next · 83 days")).toBeTruthy();
    expect(screen.getByText("Tue, 26 Jan 2027")).toBeTruthy();
    expect(screen.getByText("in 332 days")).toBeTruthy();
  });

  it("sends an admin to the admin home", async () => {
    const router = await renderApp("/employee", asAdmin());
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin"));
  });
});

describe("my leave", () => {
  it("shows an empty state with the current app's words", async () => {
    await renderApp("/employee/leave", asEmployee());
    expect(await screen.findByText("No leave requests yet")).toBeTruthy();
    expect(screen.getByText("Use the form to request casual or sick leave. It shows up here.")).toBeTruthy();
  });

  it("lists my requests newest first with dates, working days, half days and status, and only mine", async () => {
    const backend = asEmployee();
    backend.requests = [
      leave({ id: "r1", appliedOn: "2026-11-02" }),
      leave({ id: "r2", type: "Sick leave", from: "2026-11-23", to: "2026-11-23", days: 0.5, halfDay: true, status: "approved", appliedOn: "2026-11-03" }),
      leave({ id: "r3", employeeId: "e2", from: "2026-12-01", to: "2026-12-01", days: 1 }), // someone else's
    ];
    await renderApp("/employee/leave", backend);
    const t = await inTable();
    const rows = t.getAllByRole("row");
    expect(rows).toHaveLength(3); // header + mine
    expect(within(rows[1]).getByText("Sick leave")).toBeTruthy(); // newest first
    expect(within(rows[1]).getByText("23 Nov · 0.5 days (half day)")).toBeTruthy();
    expect(within(rows[1]).getByText("Applied 3 Nov")).toBeTruthy();
    expect(within(rows[1]).getByText("Approved")).toBeTruthy();
    expect(within(rows[2]).getByText("16–18 Nov · 3 days")).toBeTruthy();
    expect(within(rows[2]).getByText("Pending")).toBeTruthy();
  });

  it("offers Withdraw on pending leave, withdraws it at once and says so", async () => {
    const backend = asEmployee();
    backend.requests = [leave({})];
    await renderApp("/employee/leave", backend);
    const t = await inTable();
    await userEvent.click(t.getByRole("button", { name: "Withdraw, 16–18 Nov" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Leave withdrawn", { description: "16–18 Nov" }));
    expect(backend.requests[0].status).toBe("cancelled");
    await waitFor(async () => expect((await inTable()).getByText("Cancelled")).toBeTruthy());
    expect((await inTable()).queryByRole("button", { name: /Withdraw|Cancel leave/ })).toBeNull();
  });

  it("offers Cancel leave on approved leave that hasn't started: it goes to the admin as a request and the row says so", async () => {
    const backend = asEmployee();
    backend.requests = [leave({ status: "approved" })];
    await renderApp("/employee/leave", backend);
    await userEvent.click((await inTable()).getByRole("button", { name: "Cancel leave, 16–18 Nov" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cancellation requested", { description: "16–18 Nov · waiting for approval" }));
    expect(backend.requests[0]).toMatchObject({ status: "approved", cancelRequested: true });
    await waitFor(async () => expect((await inTable()).getByText("Cancellation pending")).toBeTruthy());
    expect((await inTable()).queryByRole("button", { name: /Cancel leave/ })).toBeNull(); // not twice
  });

  it("offers no cancel button on leave that has started, on rejected leave, or once cancelled", async () => {
    const backend = asEmployee();
    backend.requests = [
      leave({ id: "a", status: "approved", from: "2026-11-02", to: "2026-11-03", days: 2 }),
      leave({ id: "b", status: "rejected", from: "2026-11-23", to: "2026-11-23", days: 1 }),
      leave({ id: "c", status: "cancelled", from: "2026-11-24", to: "2026-11-24", days: 1 }),
    ];
    await renderApp("/employee/leave", backend);
    const t = await inTable();
    expect(t.queryByRole("button", { name: /Withdraw|Cancel leave/ })).toBeNull();
    expect(t.getByText("Rejected")).toBeTruthy();
  });

  it("shows the server's message when cancelling is refused", async () => {
    const backend = asEmployee();
    backend.requests = [leave({})];
    await renderApp("/employee/leave", backend);
    const t = await inTable();
    backend.requests[0].status = "rejected"; // decided by an admin in the meantime
    await userEvent.click(t.getByRole("button", { name: "Withdraw, 16–18 Nov" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That request is already closed."));
  });
});

describe("requesting leave", () => {
  const open = async (backend = asEmployee()) => {
    await renderApp("/employee/leave", backend);
    await screen.findByText("Request leave", { selector: "[data-slot=card-title]" });
    return backend;
  };

  it("offers casual and sick leave, full or half day, and explains the rules", async () => {
    await open();
    expect(Array.from(select("Type").options).map((o) => o.textContent)).toEqual(["Casual leave", "Sick leave"]);
    expect(Array.from(select("How long").options).map((o) => o.textContent)).toEqual(["Full day", "Half day"]);
    expect(screen.getByText(/A half day counts as 0\.5 day\. Saturdays, Sundays and national holidays aren't deducted, and approved comp-off is used first\./)).toBeTruthy();
  });

  it("sends the request, toasts the dates and shows it in the list", async () => {
    const backend = await open();
    await userEvent.type(field("From"), "2026-11-16");
    await userEvent.type(field("To"), "2026-11-18");
    await userEvent.click(screen.getByRole("button", { name: "Request leave" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Casual leave requested", { description: "16–18 Nov · waiting for approval" }));
    expect(backend.callsTo("POST", "/api/employee/leave")[0].body).toEqual({ type: "Casual leave", dayLength: "full", from: "2026-11-16", to: "2026-11-18" });
    expect((await inTable()).getByText("Pending")).toBeTruthy();
    expect(field("From").value).toBe("");
  });

  it("a half day needs one date: the To field is turned off and the toast says half day", async () => {
    const backend = await open();
    await userEvent.selectOptions(select("How long"), "half");
    expect(screen.getByLabelText("Date")).toBeTruthy(); // From is relabelled
    expect((field("To") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Not needed for a half day.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Date"), "2026-11-16");
    await userEvent.click(screen.getByRole("button", { name: "Request leave" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Casual leave requested", { description: "16 Nov (half day) · waiting for approval" }));
    expect(backend.callsTo("POST", "/api/employee/leave")[0].body).toMatchObject({ dayLength: "half", to: "" });
  });

  it("shows the server's field messages and keeps the dates", async () => {
    await open();
    await userEvent.type(field("From"), "2026-11-18");
    await userEvent.type(field("To"), "2026-11-16");
    await userEvent.click(screen.getByRole("button", { name: "Request leave" }));
    expect(await screen.findByText("The end date can't be before the start date.")).toBeTruthy();
    expect(field("From").value).toBe("2026-11-18");
    expect(field("To").getAttribute("aria-invalid")).toBe("true");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("asks for a start date", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Request leave" }));
    expect(await screen.findByText("Pick a start date.")).toBeTruthy();
  });

  it("shows an overlap as an alert above the form", async () => {
    const backend = asEmployee();
    backend.requests = [leave({})];
    await open(backend);
    await userEvent.type(field("From"), "2026-11-17");
    await userEvent.type(field("To"), "2026-11-17");
    await userEvent.click(screen.getByRole("button", { name: "Request leave" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You already have leave that overlaps these dates.");
  });

  it("shows the not-enough-leave message without any number in it", async () => {
    const backend = asEmployee();
    backend.overdrawn = true;
    await open(backend);
    await userEvent.type(field("From"), "2026-11-16");
    await userEvent.type(field("To"), "2026-11-16");
    await userEvent.click(screen.getByRole("button", { name: "Request leave" }));
    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert).toContain("You don't have enough leave left for these dates. Ask your admin if you need more.");
    expect(alert).not.toMatch(/\d/);
  });

  it("shows 'Sending…' and blocks a second click while it runs", async () => {
    const backend = await open();
    await userEvent.type(field("From"), "2026-11-16");
    await userEvent.type(field("To"), "2026-11-16");
    backend.hold();
    await userEvent.click(screen.getByRole("button", { name: "Request leave" }));
    expect(((await screen.findByRole("button", { name: "Sending…" })) as HTMLButtonElement).disabled).toBe(true);
    backend.release();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(backend.callsTo("POST", "/api/employee/leave")).toHaveLength(1);
  });
});

describe("comp-off (employee)", () => {
  it("lists my claims with what they earn and when they expire, and an empty state otherwise", async () => {
    const empty = asEmployee();
    await renderApp("/employee/comp-off", empty);
    expect(await screen.findByText("No comp-off requests yet")).toBeTruthy();
    expect(screen.getByText("Worked a weekend or a national holiday? Request comp-off with the form.")).toBeTruthy();
  });

  it("shows a claim as 'Worked <day>' with days earned, applied date and expiry", async () => {
    const backend = asEmployee();
    backend.requests = [{ id: "c1", employeeId: "e1", type: "Comp-off", status: "approved", from: "2026-10-31", to: "2026-10-31", appliedOn: "2026-11-02", days: 0.5, halfDay: true, expiresOn: "2027-01-05" }];
    await renderApp("/employee/comp-off", backend);
    const row = (await inTable()).getAllByRole("row")[1];
    expect(within(row).getByText("Worked Sat, 31 Oct 2026")).toBeTruthy();
    expect(within(row).getByText("0.5 days (half day)")).toBeTruthy();
    expect(within(row).getByText("Applied 2 Nov · expires 5 Jan 2027")).toBeTruthy();
    expect(within(row).getByText("Approved")).toBeTruthy();
    expect(within(row).queryByRole("button")).toBeNull(); // comp-off can't be cancelled here
  });

  it("a rejected claim shows no expiry", async () => {
    const backend = asEmployee();
    backend.requests = [{ id: "c1", employeeId: "e1", type: "Comp-off", status: "rejected", from: "2026-10-31", to: "2026-10-31", appliedOn: "2026-11-02", days: 1, expiresOn: "2027-01-05" }];
    await renderApp("/employee/comp-off", backend);
    expect(await screen.findAllByText("Applied 2 Nov")).toBeTruthy();
    expect(document.body.textContent).not.toContain("expires");
  });

  it("claims a Saturday, toasts, and shows it waiting", async () => {
    const backend = asEmployee();
    await renderApp("/employee/comp-off", backend);
    await screen.findByText("Request comp-off", { selector: "[data-slot=card-title]" });
    expect(Array.from(select("How long").options).map((o) => o.textContent)).toEqual(["Full day (1 comp-off day)", "Half day (0.5 comp-off day)"]);
    await userEvent.type(field("Day you worked"), "2026-10-31");
    await userEvent.click(screen.getByRole("button", { name: "Request comp-off" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Comp-off requested", { description: "31 Oct 2026 · waiting for approval" }));
    expect((await inTable()).getByText("Pending")).toBeTruthy();
    expect(screen.getByText("It's added to your leave balance once an admin approves it.")).toBeTruthy();
  });

  it("shows the server's refusals: a working day, a future day, a day already claimed", async () => {
    const backend = asEmployee();
    await renderApp("/employee/comp-off", backend);
    await screen.findByText("Request comp-off", { selector: "[data-slot=card-title]" });
    for (const [day, message] of [
      ["2026-11-03", "That was a working day, so it doesn't earn comp-off. Pick a weekend or a national holiday."],
      ["2026-11-07", "That day hasn't happened yet."],
    ] as const) {
      await userEvent.clear(field("Day you worked"));
      await userEvent.type(field("Day you worked"), day);
      await userEvent.click(screen.getByRole("button", { name: "Request comp-off" }));
      expect(await screen.findByText(message)).toBeTruthy();
    }
    await userEvent.clear(field("Day you worked"));
    await userEvent.type(field("Day you worked"), "2026-10-31");
    await userEvent.click(screen.getByRole("button", { name: "Request comp-off" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    await userEvent.type(field("Day you worked"), "2026-10-31");
    await userEvent.click(screen.getByRole("button", { name: "Request comp-off" }));
    expect(await screen.findByText("You've already claimed comp-off for that day.")).toBeTruthy();
  });
});

describe("permissions (employee)", () => {
  it("starts empty, then notes a permission and lists it with its length and the running total", async () => {
    await renderApp("/employee/permissions", asEmployee());
    expect(await screen.findByText("No permissions yet")).toBeTruthy();
    expect(screen.getByText("When you take a few hours off, note it with the form.")).toBeTruthy();
    await userEvent.type(field("Day"), "2026-11-05");
    await userEvent.type(field("From"), "10:00");
    await userEvent.type(field("To"), "11:30");
    await userEvent.type(field("Reason (optional)"), "Bank work");
    await userEvent.click(screen.getByRole("button", { name: "Note permission" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Permission noted", { description: "5 Nov 2026 · 10:00–11:30" }));
    const row = (await inTable()).getAllByRole("row")[1];
    expect(within(row).getByText("Thu, 5 Nov 2026")).toBeTruthy();
    expect(within(row).getByText("10:00–11:30")).toBeTruthy();
    expect(within(row).getByText("1 hr 30 min")).toBeTruthy();
    expect(within(row).getByText("Bank work")).toBeTruthy();
    expect(screen.getByText(/1 so far, 1 hr 30 min in total\./)).toBeTruthy();
    expect(field("Day").value).toBe("");
    expect(screen.getByText(/isn't taken from your leave/)).toBeTruthy();
  });

  it("shows the server's messages and keeps what was typed, including an overlap", async () => {
    const backend = asEmployee();
    backend.permissions = [{ id: "p1", employeeId: "e1", date: "2026-11-05", from: "10:00", to: "11:00", minutes: 60, reason: "" }];
    await renderApp("/employee/permissions", backend);
    await screen.findAllByText("10:00–11:00");
    await userEvent.type(field("Day"), "2026-11-05");
    await userEvent.type(field("From"), "11:00");
    await userEvent.type(field("To"), "10:00");
    await userEvent.click(screen.getByRole("button", { name: "Note permission" }));
    expect(await screen.findByText("The end time has to be after the start time.")).toBeTruthy();
    expect(field("From").value).toBe("11:00");
    await userEvent.clear(field("From"));
    await userEvent.type(field("From"), "10:30");
    await userEvent.clear(field("To"));
    await userEvent.type(field("To"), "11:30");
    await userEvent.click(screen.getByRole("button", { name: "Note permission" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You already have a permission that overlaps this time.");
  });

  it("limits the reason to 200 characters", async () => {
    await renderApp("/employee/permissions", asEmployee());
    await screen.findByText("No permissions yet");
    expect(field("Reason (optional)").maxLength).toBe(200);
  });
});

describe("holidays", () => {
  it("shows the same four holidays to an employee and to an admin", async () => {
    await renderApp("/employee/holidays", asEmployee());
    for (const name of ["Republic Day", "Labour Day", "Independence Day", "Gandhi Jayanti"]) expect(await screen.findByText(name)).toBeTruthy();
    expect(screen.getByText("National holidays, soonest first.")).toBeTruthy();
  });

  it("is read only for the admin too, as in the current app (no add, edit or remove)", async () => {
    await renderApp("/admin/holidays", asAdmin());
    expect(await screen.findByText("Upcoming holidays")).toBeTruthy();
    expect(within(screen.getByRole("main")).queryByRole("button")).toBeNull();
    expect(within(screen.getByRole("main")).getAllByRole("listitem")).toHaveLength(4);
  });
});

// ================================================================ admin side

describe("the admin dashboard", () => {
  const seed = (backend: FakeBackend) => {
    backend.requests = [
      leave({ id: "r1" }),
      leave({ id: "r2", from: "2026-11-23", to: "2026-11-23", days: 1, status: "approved", cancelRequested: true, cancelRequestedOn: "2026-11-03" }),
      { id: "c1", employeeId: "e2", type: "Comp-off", status: "pending", from: "2026-10-31", to: "2026-10-31", appliedOn: "2026-11-02", days: 1 },
    ];
    backend.adminDashboard.monthly = [
      { month: "Oct", approved: 2, pending: 0 }, { month: "Nov", approved: 3, pending: 1.5 },
    ];
    backend.adminDashboard.balances = [
      { employeeId: "e1", name: "Asha Rao", category: "employee", total: 25, casual: 2, sick: 1, used: 3, remaining: 22, compOffAvailable: 1, compOffExpired: 0.5 },
      { employeeId: "e2", name: "Dev Patel", category: "intern", total: 10, casual: 0, sick: 0, used: 0, remaining: 10, compOffAvailable: 0, compOffExpired: 0 },
    ];
    backend.adminDashboard.outThisWeek = [{ id: "o1", employeeName: "Asha Rao", type: "Sick leave", from: "2026-11-04", to: "2026-11-05", halfDay: false }];
    return backend;
  };

  it("greets by time of day and counts what is waiting and who is out", async () => {
    await renderApp("/admin", seed(asAdmin()));
    expect(await screen.findByText("Good morning, Priya")).toBeTruthy();
    expect(screen.getByText("Wednesday, 4 November 2026")).toBeTruthy();
    expect(screen.getByText("3 requests")).toBeTruthy();
    expect(screen.getByText(/waiting for your decision/)).toBeTruthy();
    expect(screen.getByText("1 person")).toBeTruthy();
  });

  it("says nothing is waiting and nobody is out when that is true", async () => {
    const backend = asAdmin();
    backend.adminDashboard.outTodayCount = 0;
    await renderApp("/admin", backend);
    expect(await screen.findByText(/No requests waiting for your decision/)).toBeTruthy();
    expect(screen.getByText(/nobody is out today/)).toBeTruthy();
    expect(screen.getByText("You're all caught up")).toBeTruthy();
    expect(screen.getByText("Everyone's in")).toBeTruthy();
  });

  it("splits the pending count into leave, comp-off and cancellation requests, and shows the next holiday", async () => {
    await renderApp("/admin", seed(asAdmin()));
    expect(await screen.findByText("1 leave · 1 comp-off · 1 cancellation")).toBeTruthy();
    expect(screen.getByText("of 2 employees")).toBeTruthy();
    expect(screen.getByText("83 days")).toBeTruthy();
    expect(screen.getByText("Republic Day · 26 Jan 2027")).toBeTruthy();
  });

  it("lists everything waiting: pending leave, comp-off, and a cancellation with 'Keep leave'", async () => {
    await renderApp("/admin", seed(asAdmin()));
    expect(await screen.findByText("Needs your attention")).toBeTruthy();
    expect(screen.getByText("Casual leave · 16–18 Nov · 3 days")).toBeTruthy();
    expect(screen.getByText("Comp-off · Worked Sat, 31 Oct 2026 · 1 day")).toBeTruthy();
    expect(screen.getByText("Cancel casual leave · 23 Nov · 1 day")).toBeTruthy();
    expect(screen.getByText("Cancellation requested 3 Nov")).toBeTruthy();
    expect(screen.getByText("Cancellation pending")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject Cancellation for Asha Rao" }).textContent).toContain("Keep leave");
  });

  it("approves a request: toast with the first name, and it leaves the list", async () => {
    const backend = seed(asAdmin());
    await renderApp("/admin", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Approve Casual leave for Asha Rao" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Casual leave approved for Asha", { description: "16–18 Nov · 3 days" }));
    expect(backend.callsTo("POST", "/api/admin/requests/r1/decision")[0].body).toEqual({ decision: "approved" });
    await waitFor(() => expect(screen.queryByText("Casual leave · 16–18 Nov · 3 days")).toBeNull());
  });

  it("rejects a request, and approves a comp-off", async () => {
    const backend = seed(asAdmin());
    await renderApp("/admin", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Reject Casual leave for Asha Rao" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Casual leave rejected for Asha", { description: "16–18 Nov · 3 days" }));
    expect(backend.requests[0].status).toBe("rejected");
    await userEvent.click(await screen.findByRole("button", { name: "Approve Comp-off for Dev Patel" }));
    await waitFor(() => expect(backend.requests[2].status).toBe("approved"));
  });

  it("approving a cancellation cancels the leave; keeping it leaves the leave approved", async () => {
    const backend = seed(asAdmin());
    await renderApp("/admin", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Approve Cancellation for Asha Rao" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cancellation approved for Asha", { description: "23 Nov · 1 day" }));
    expect(backend.requests[1]).toMatchObject({ status: "cancelled", cancelRequested: false });

    const kept = seed(asAdmin());
    vi.clearAllMocks();
    document.body.innerHTML = "";
    await renderApp("/admin", kept);
    await userEvent.click(await screen.findByRole("button", { name: "Reject Cancellation for Asha Rao" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cancellation rejected for Asha", { description: "23 Nov · 1 day" }));
    expect(kept.requests[1]).toMatchObject({ status: "approved", cancelRequested: false });
  });

  it("tells the admin when somebody else already handled the request", async () => {
    const backend = seed(asAdmin());
    await renderApp("/admin", backend);
    const button = await screen.findByRole("button", { name: "Approve Casual leave for Asha Rao" });
    backend.requests[0].status = "rejected";
    await userEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't update the request. It may have already been handled."));
  });

  it("shows leave by month, who is out this week and every employee's balance with the comp-off note and a team total", async () => {
    await renderApp("/admin", seed(asAdmin()));
    expect(await screen.findByText("Leave by month")).toBeTruthy();
    expect(screen.getByText("Team leave days in 2026, excluding comp-off and national holidays.")).toBeTruthy();
    expect(screen.getByText("From 1 pending leave request")).toBeTruthy();
    expect(screen.getByText("Who's out this week")).toBeTruthy();
    expect(screen.getByText("2 Nov – 8 Nov")).toBeTruthy();
    expect(screen.getByText("Out today")).toBeTruthy();
    const t = await inTable();
    const rows = t.getAllByRole("row");
    expect(within(rows[1]).getByText("Asha Rao")).toBeTruthy();
    expect(within(rows[1]).getByText("Employee")).toBeTruthy();
    expect(within(rows[1]).getByText("incl. 1 comp-off · 0.5 expired")).toBeTruthy();
    expect(within(rows[2]).getByText("Intern")).toBeTruthy();
    const total = rows[rows.length - 1];
    expect(within(total).getByText("Team total")).toBeTruthy();
    expect(within(total).getByText("35")).toBeTruthy(); // 25 + 10
    expect(within(rows[1]).getByRole("progressbar", { name: "Asha Rao: 3 of 25 leave days used" })).toBeTruthy();
  });

  it("with no employees, balances say so and offer to add one", async () => {
    const backend = asAdmin();
    backend.adminDashboard.teamSize = 0;
    await renderApp("/admin", backend);
    expect(await screen.findByText("No employees yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add an employee" }).getAttribute("href")).toBe("/admin/employees");
  });
});

describe("the admin's leave requests and comp-off pages", () => {
  const seed = (backend: FakeBackend) => {
    backend.requests = [
      leave({ id: "r1" }),
      leave({ id: "r2", status: "approved", from: "2026-11-23", to: "2026-11-23", days: 1, appliedOn: "2026-11-01" }),
      leave({ id: "r3", status: "approved", from: "2026-11-25", to: "2026-11-25", days: 1, appliedOn: "2026-10-30", cancelRequested: true, cancelRequestedOn: "2026-11-03" }),
      leave({ id: "r4", status: "rejected", from: "2026-12-01", to: "2026-12-01", days: 1, appliedOn: "2026-10-20" }),
      { id: "c1", employeeId: "e2", type: "Comp-off", status: "pending", from: "2026-10-31", to: "2026-10-31", appliedOn: "2026-11-02", days: 1 },
    ];
    return backend;
  };

  it("lists everyone's leave requests, newest first, with names and statuses, and none of the comp-off", async () => {
    await renderApp("/admin/leave", seed(asAdmin()));
    expect(await screen.findByText("Leave requests", { selector: "[data-slot=card-title]" })).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(within(items[0]).getByText("Asha Rao")).toBeTruthy();
    expect(within(items[0]).getByText("Pending")).toBeTruthy();
    expect(within(items[3]).getByText("Rejected")).toBeTruthy();
    expect(screen.queryByText(/Worked/)).toBeNull();
    expect(screen.getByText(/2 waiting for a decision\./)).toBeTruthy(); // one pending + one cancellation
  });

  it("offers a decision only on what is waiting, including 'Keep leave' on a cancellation, and decides it", async () => {
    const backend = seed(asAdmin());
    await renderApp("/admin/leave", backend);
    await screen.findByText("Leave requests", { selector: "[data-slot=card-title]" });
    expect(screen.getAllByRole("button", { name: /^Approve / })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Reject Cancellation for Asha Rao" }).textContent).toContain("Keep leave");
    await userEvent.click(screen.getByRole("button", { name: "Approve Cancellation for Asha Rao" }));
    await waitFor(() => expect(backend.requests[2].status).toBe("cancelled"));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Approve / })).toHaveLength(1));
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });

  it("an employee who cancels, and the admin who approves it, end with the leave cancelled", async () => {
    const backend = seed(asAdmin());
    backend.requests = [leave({ id: "r9", status: "approved" })];
    backend.signIn("asha@lumiether.test");
    await renderApp("/employee/leave", backend);
    await userEvent.click((await inTable()).getByRole("button", { name: "Cancel leave, 16–18 Nov" }));
    await waitFor(() => expect(backend.requests[0].cancelRequested).toBe(true));
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    backend.signIn("priya@lumiether.test");
    await renderApp("/admin/leave", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Approve Cancellation for Asha Rao" }));
    await waitFor(() => expect(backend.requests[0].status).toBe("cancelled"));
  });

  it("lists comp-off claims with what they earn, and shows an empty state when there are none", async () => {
    await renderApp("/admin/comp-off", seed(asAdmin()));
    expect(await screen.findByText("Comp-off requests", { selector: "[data-slot=card-title]" })).toBeTruthy();
    expect(screen.getByText("Comp-off · Worked Sat, 31 Oct 2026 · 1 day")).toBeTruthy();
    expect(screen.getByText("Dev Patel")).toBeTruthy();
    expect(screen.queryByText("Casual leave", { exact: false })).toBeNull();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    await renderApp("/admin/comp-off", asAdmin());
    expect(await screen.findByText("No comp-off requests yet")).toBeTruthy();
    expect(screen.getByText("Comp-off your team claims will show up here.")).toBeTruthy();
  });

  it("approving a comp-off claim from here decides it", async () => {
    const backend = seed(asAdmin());
    await renderApp("/admin/comp-off", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Approve Comp-off for Dev Patel" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Comp-off approved for Dev", { description: "Worked Sat, 31 Oct 2026 · 1 day" }));
    expect(backend.requests[4].status).toBe("approved");
  });

  it("keeps employees out of the admin pages", async () => {
    const router = await renderApp("/admin/leave", asEmployee());
    await waitFor(() => expect(router.state.location.pathname).toBe("/employee"));
  });
});

describe("permissions (admin)", () => {
  it("lists everyone's permissions with names, newest day first, with a total", async () => {
    const backend = asAdmin();
    backend.permissions = [
      { id: "p1", employeeId: "e1", date: "2026-11-05", from: "10:00", to: "11:00", minutes: 60, reason: "" },
      { id: "p2", employeeId: "e2", date: "2026-11-09", from: "15:00", to: "15:45", minutes: 45, reason: "Bank work" },
    ];
    await renderApp("/admin/permissions", backend);
    const rows = (await inTable()).getAllByRole("row");
    expect(within(rows[1]).getByText("Dev Patel")).toBeTruthy(); // newest day first
    expect(within(rows[1]).getByText("45 min")).toBeTruthy();
    expect(within(rows[2]).getByText("—")).toBeTruthy(); // no reason
    expect(screen.getByText(/Short absences your team has noted\. They aren't taken from leave\. 2 so far, 1 hr 45 min in total\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Note permission" })).toBeNull(); // the admin only reads
  });

  it("shows the empty state in the current app's words", async () => {
    await renderApp("/admin/permissions", asAdmin());
    expect(await screen.findByText("No permissions yet")).toBeTruthy();
    expect(screen.getByText("Permissions your team notes will show up here.")).toBeTruthy();
  });
});

describe("leave policy", () => {
  it("lists the four categories with their days and headcount, and tells admins employees never see these numbers", async () => {
    await renderApp("/admin/leave-policy", asAdmin());
    expect(await screen.findByText("Leave days per year")).toBeTruthy();
    expect(screen.getByText(/Employees never see these numbers\./)).toBeTruthy();
    for (const label of ["Contractor", "Employee", "Intern", "Student"]) expect(screen.getByText(label)).toBeTruthy();
    expect(field("Employee").value).toBe("24");
    expect(screen.getAllByText("1 person")).toHaveLength(2); // Employee: Asha, Intern: Dev
    expect(screen.getAllByText("0 people")).toHaveLength(2);
    expect(screen.getAllByText("days a year")).toHaveLength(4);
  });

  it("saves all four, toasts, and the fields show what was saved", async () => {
    const backend = asAdmin();
    await renderApp("/admin/leave-policy", backend);
    await screen.findByText("Leave days per year");
    await userEvent.clear(field("Intern"));
    await userEvent.type(field("Intern"), "10");
    await userEvent.clear(field("Student"));
    await userEvent.type(field("Student"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Save leave days" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Leave days saved", { description: "Applied to everyone in each category." }));
    expect(backend.callsTo("PUT", "/api/admin/leave-policy")[0].body).toEqual({ contractor: "24", employee: "24", intern: "10", student: "0" });
    expect(backend.policy).toEqual({ contractor: 24, employee: 24, intern: 10, student: 0 });
    await waitFor(() => expect(field("Intern").value).toBe("10"));
  });

  it("refuses a blank, fractional or out-of-range value with the current app's messages and saves nothing", async () => {
    const backend = asAdmin();
    await renderApp("/admin/leave-policy", backend);
    await screen.findByText("Leave days per year");
    await userEvent.clear(field("Contractor"));
    await userEvent.clear(field("Employee"));
    await userEvent.type(field("Employee"), "367");
    await userEvent.clear(field("Intern"));
    await userEvent.type(field("Intern"), "1.5");
    await userEvent.click(screen.getByRole("button", { name: "Save leave days" }));
    expect(await screen.findAllByText("Enter a whole number of days.")).toHaveLength(2); // blank and 1.5
    expect(screen.getByText("Use a number between 0 and 366.")).toBeTruthy();
    expect(field("Employee").value).toBe("367"); // what was typed stays
    expect(field("Employee").getAttribute("aria-invalid")).toBe("true");
    expect(backend.policy).toEqual({ contractor: 24, employee: 24, intern: 24, student: 24 });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("limits the fields to whole days between 0 and 366", async () => {
    await renderApp("/admin/leave-policy", asAdmin());
    await screen.findByText("Leave days per year");
    const f = field("Intern");
    expect([f.type, f.min, f.max, f.step]).toEqual(["number", "0", "366", "1"]);
  });
});
