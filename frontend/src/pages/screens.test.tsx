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

describe("the admins screen", () => {
  it("sets the tab title to the page name", async () => {
    await renderApp("/admin/admins", asAdmin());
    await screen.findByRole("list");
    expect(document.title).toBe("Admins · Leave Management");
  });

  it("lists every admin with initials, name and email, and marks you", async () => {
    await renderApp("/admin/admins", asAdmin());
    const list = await screen.findByRole("list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Priya Sharma")).toBeTruthy();
    expect(within(rows[0]).getByText("priya@lumiether.test")).toBeTruthy();
    expect(within(rows[0]).getByText("PS")).toBeTruthy();
    expect(within(rows[0]).getByText("You")).toBeTruthy();
    expect(screen.getByText(/^2 admins\./)).toBeTruthy();
  });

  it("never offers to remove yourself (no removing yourself)", async () => {
    await renderApp("/admin/admins", asAdmin());
    await screen.findByRole("list");
    expect(screen.queryByRole("button", { name: "Remove Priya Sharma as admin" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Ravi Kumar as admin" })).toBeTruthy();
  });

  it("asks before removing, and Keep admin changes nothing", async () => {
    const backend = asAdmin();
    await renderApp("/admin/admins", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Ravi Kumar as admin" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Remove Ravi Kumar as admin?")).toBeTruthy();
    expect(within(dialog).getByText("ravi@lumiether.test will be signed out straight away and lose all admin access.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep admin" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(backend.callsTo("DELETE", "/api/admin/admins/a2")).toHaveLength(0);
    expect(screen.getByText("Ravi Kumar")).toBeTruthy();
  });

  it("removes another admin, toasts, and the list updates", async () => {
    const backend = asAdmin();
    await renderApp("/admin/admins", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Ravi Kumar as admin" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove admin" }));
    await waitFor(() => expect(screen.queryByText("Ravi Kumar")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Ravi Kumar is no longer an admin", { description: "ravi@lumiether.test" });
    expect(screen.getByText(/^1 admin\./)).toBeTruthy();
    expect(backend.callsTo("DELETE", "/api/admin/admins/a2")[0].credentials).toBe("include");
  });

  it("shows the backend's reason when it refuses (you, the last admin, already gone) and keeps the list", async () => {
    const backend = asAdmin();
    await renderApp("/admin/admins", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Ravi Kumar as admin" }));
    // someone else removed Ravi first
    backend.users = backend.users.filter((u) => u.id !== "a2");
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove admin" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That admin no longer exists."));
  });

  it.each(["You can't remove your own admin account.", "There has to be at least one admin."])(
    "shows the backend's rule word for word when it refuses: %s",
    async (message) => {
      const backend = asAdmin();
      backend.removalRefusal = message;
      await renderApp("/admin/admins", backend);
      await userEvent.click(await screen.findByRole("button", { name: "Remove Ravi Kumar as admin" }));
      await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove admin" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
      expect(toast.success).not.toHaveBeenCalled();
      expect(screen.getByText("Ravi Kumar")).toBeTruthy(); // still listed
    },
  );

  it("follows the real rules end to end against the fake: remove the other admin, then nobody is left to remove", async () => {
    const backend = asAdmin();
    await renderApp("/admin/admins", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Ravi Kumar as admin" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove admin" }));
    await waitFor(() => expect(screen.queryByText("Ravi Kumar")).toBeNull());
    expect(screen.queryAllByRole("button", { name: /^Remove / })).toHaveLength(0); // only "You" is left
    expect(screen.getByText("You")).toBeTruthy();
  });

  it("sends you to /login if the session ended while you were on the page", async () => {
    const backend = asAdmin();
    const router = await renderApp("/admin/admins", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Ravi Kumar as admin" }));
    backend.signedInAs = null;
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove admin" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });

  it("shows an inline error with Retry when the list can't load, and the shell stays", async () => {
    const backend = asAdmin();
    backend.forced["/api/admin/admins"] = 500;
    await renderApp("/admin/admins", backend);
    expect(await screen.findByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    delete backend.forced["/api/admin/admins"];
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Ravi Kumar")).toBeTruthy();
  });

  it("shows the running-figure loader while moving to the page", async () => {
    const backend = asAdmin();
    const router = await renderApp("/admin", backend);
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    backend.hold();
    await userEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Admins" }));
    expect(screen.getByRole("status").textContent).toContain("Loading");
    await act(async () => backend.release());
    expect(await screen.findByText("Ravi Kumar")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/admin/admins");
  });
});

describe("adding an admin", () => {
  const email = () => screen.getByLabelText("Email address") as HTMLInputElement;
  const pw = () => screen.getByLabelText("Temporary password") as HTMLInputElement;
  const add = () => userEvent.click(screen.getByRole("button", { name: "Add admin" }));

  it("explains the form", async () => {
    await renderApp("/admin/admins", asAdmin());
    await screen.findByRole("list");
    expect(screen.getByText("Add an admin")).toBeTruthy();
    expect(screen.getByText("They get the same access as you, including adding more admins.")).toBeTruthy();
    expect(screen.getByText("At least 8 characters. Share it with them directly; they can change it after signing in.")).toBeTruthy();
    expect(pw().type).toBe("text"); // visible on purpose: the admin has to read it out
  });

  it("adds the admin, toasts with the name derived from the email, clears the form and lists them", async () => {
    const backend = asAdmin();
    await renderApp("/admin/admins", backend);
    await screen.findByRole("list");
    await userEvent.type(email(), "  New.Person@Lumiether.test ");
    await userEvent.type(pw(), "temp-pass-1");
    await add();
    expect(await screen.findByText("New Person")).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith("New Person is now an admin", { description: "new.person@lumiether.test" });
    expect(email().value).toBe("");
    expect(pw().value).toBe("");
    expect(backend.callsTo("POST", "/api/admin/admins")[0].body).toEqual({ email: "New.Person@Lumiether.test", password: "temp-pass-1" });
    expect(screen.getByText(/^3 admins\./)).toBeTruthy();
  });

  it.each([
    ["not-an-email", "temp-pass-1", "Enter a valid email address.", "email"],
    ["ravi@lumiether.test", "temp-pass-1", "Someone already uses this email.", "email"],
    ["asha@lumiether.test", "temp-pass-1", "Someone already uses this email.", "email"],
    ["fresh@lumiether.test", "short", "Use at least 8 characters.", "password"],
  ])("shows %s / %s as: %s", async (e, p, message, field) => {
    const backend = asAdmin();
    await renderApp("/admin/admins", backend);
    await screen.findByRole("list");
    await userEvent.type(email(), e);
    await userEvent.type(pw(), p);
    await add();
    const input = field === "email" ? email() : pw();
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText(message)).toBeTruthy();
    expect(email().value).toBe(e); // the email stays so it can be fixed
    expect(pw().value).toBe(""); // the password doesn't
    expect(toast.success).not.toHaveBeenCalled();
    expect(backend.users.some((u) => u.email === e.toLowerCase() && u.role === "admin" && e !== "ravi@lumiether.test")).toBe(false);
  });

  it("says so inline when the server fails, and keeps the email", async () => {
    const backend = asAdmin();
    await renderApp("/admin/admins", backend);
    await screen.findByRole("list");
    backend.forced["/api/admin/admins"] = 500;
    await userEvent.type(email(), "fresh@lumiether.test");
    await userEvent.type(pw(), "temp-pass-1");
    await add();
    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong. Please try again.");
    expect(email().value).toBe("fresh@lumiether.test");
  });

  it("disables the button while saving", async () => {
    const backend = asAdmin();
    await renderApp("/admin/admins", backend);
    await screen.findByRole("list");
    backend.hold();
    await userEvent.type(email(), "fresh@lumiether.test");
    await userEvent.type(pw(), "temp-pass-1");
    await add();
    expect((screen.getByRole("button", { name: "Adding…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => backend.release());
    await screen.findByText("Fresh");
  });
});

describe("the change-password screen", () => {
  const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
  const fill = async (current: string, next: string, confirm: string) => {
    if (current) await userEvent.type(field("Current password"), current);
    if (next) await userEvent.type(field("New password"), next);
    if (confirm) await userEvent.type(field("Confirm new password"), confirm);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
  };

  it("shows the card, the three password fields and the hint", async () => {
    await renderApp("/admin/password", asAdmin());
    expect(await screen.findByText("Choose a new password for your admin account. You'll stay signed in here; other devices are signed out.")).toBeTruthy();
    for (const n of ["Current password", "New password", "Confirm new password"]) expect(field(n).type).toBe("password");
    expect(screen.getByText("At least 8 characters.")).toBeTruthy();
  });

  it("changes the password, toasts and empties the form", async () => {
    const backend = asAdmin();
    await renderApp("/admin/password", backend);
    await screen.findByLabelText("Current password");
    await fill("correct-horse", "brand-new-pass", "brand-new-pass");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Password changed", { description: "Other devices have been signed out." }));
    expect(backend.me?.password).toBe("brand-new-pass");
    expect(field("Current password").value + field("New password").value + field("Confirm new password").value).toBe("");
    expect(backend.callsTo("POST", "/api/account/password")[0].body).toEqual({ current: "correct-horse", next: "brand-new-pass", confirm: "brand-new-pass" });
  });

  it.each([
    ["", "", "", { "Current password": "Enter your current password.", "New password": "Use at least 8 characters." }],
    ["correct-horse", "short", "short", { "New password": "Use at least 8 characters." }],
    ["wrong-password", "brand-new-pass", "brand-new-pass", { "Current password": "That isn't your current password." }],
    ["correct-horse", "correct-horse", "correct-horse", { "New password": "Choose a password you aren't already using." }],
    ["correct-horse", "brand-new-pass", "different-pass", { "Confirm new password": "The two new passwords don't match." }],
    ["wrong-password", "short", "other", { "Current password": "That isn't your current password.", "New password": "Use at least 8 characters." }],
  ])("%j / %j / %j shows the current app's messages", async (c, n, f, expected) => {
    const backend = asAdmin();
    await renderApp("/admin/password", backend);
    await screen.findByLabelText("Current password");
    await fill(c, n, f);
    for (const [name, message] of Object.entries(expected)) {
      expect(await screen.findByText(message)).toBeTruthy();
      await waitFor(() => expect(field(name).getAttribute("aria-invalid")).toBe("true"));
    }
    expect(toast.success).not.toHaveBeenCalled();
    expect(backend.me?.password).toBe("correct-horse"); // unchanged
  });

  it("says so inline when the server fails", async () => {
    const backend = asAdmin();
    await renderApp("/admin/password", backend);
    await screen.findByLabelText("Current password");
    backend.forced["/api/account/password"] = 500;
    await fill("correct-horse", "brand-new-pass", "brand-new-pass");
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't change the password. Please try again.");
  });

  it("sends you to /login if the session ended", async () => {
    const backend = asAdmin();
    const router = await renderApp("/admin/password", backend);
    await screen.findByLabelText("Current password");
    backend.signedInAs = null;
    await fill("correct-horse", "brand-new-pass", "brand-new-pass");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });

  it("works for an employee at /employee/password, with the employee wording", async () => {
    const backend = new FakeBackend().signIn("asha@lumiether.test");
    await renderApp("/employee/password", backend);
    expect(await screen.findByText(/Replace the temporary password your admin gave you/)).toBeTruthy();
    await fill("employee-pass", "brand-new-pass", "brand-new-pass");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
