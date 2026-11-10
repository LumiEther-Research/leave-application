import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { appRoutes } from "@/routes";
import { FakeBackend } from "@/test/fake-backend";
import { AppShell } from "./app-shell";

/** Renders the real routes against a fake backend, signed in as an admin (Priya Sharma) unless told otherwise. */
async function renderApp(path: string, email: string | null = "priya@lumiether.test") {
  const backend = new FakeBackend().install();
  if (email) backend.signIn(email);
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  // The shell route's loader asks /api/auth/me first; wait for the page (or the redirect) to settle.
  await act(async () => {});
  await screen.findByRole("heading", { level: 1 }).catch(() => undefined);
  return router;
}

const nav = () => screen.getByRole("navigation", { name: "Main" });

afterEach(() => vi.unstubAllGlobals());

describe("the admin shell", () => {
  it("shows the page title, the user, the role badge and the avatar initials", async () => {
    await renderApp("/admin/admins");
    expect(screen.getByRole("heading", { level: 1, name: "Admins" })).toBeTruthy();
    const header = within(screen.getByRole("banner"));
    expect(header.getByText("Priya Sharma")).toBeTruthy();
    expect(header.getByText("Admin")).toBeTruthy(); // role badge
    expect(header.getByText("PS")).toBeTruthy();
  });

  it("groups the nav under section labels, in order", async () => {
    await renderApp("/admin");
    const sections = within(nav()).getAllByText(/^(Overview|Leave|Company|Payroll|Account)$/);
    expect(sections.map((s) => s.textContent)).toEqual(["Overview", "Leave", "Company", "Payroll", "Account"]);
  });

  it("makes ready items links, marks the current one, and shows Soon on the ones the current app has not built", async () => {
    await renderApp("/admin/admins");
    const n = within(nav());
    expect(n.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/admin");
    expect(n.getByRole("link", { name: "Admins" }).getAttribute("aria-current")).toBe("page");
    expect(n.getByRole("link", { name: "Employees" }).getAttribute("aria-current")).toBeNull();
    for (const label of ["Leave requests", "Comp-off", "Holidays"]) {
      expect(n.queryByRole("link", { name: new RegExp(label) })).toBeNull(); // not a link
      const item = n.getByText(label).closest("span[aria-disabled]");
      expect(item?.getAttribute("aria-disabled")).toBe("true");
      expect(within(item as HTMLElement).getByText("Soon")).toBeTruthy();
    }
    expect(n.getAllByText("Soon")).toHaveLength(3);
  });

  it("changes the title and the highlighted item when you pick another page, without a reload", async () => {
    await renderApp("/admin");
    await userEvent.click(within(nav()).getByRole("link", { name: "Payslips" }));
    expect(screen.getByRole("heading", { level: 1, name: "Payslips" })).toBeTruthy();
    expect(within(nav()).getByRole("link", { name: "Payslips" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav()).getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByText(/arrives in Phase 4/)).toBeTruthy();
  });

  it("says which phase brings a screen that is not built yet", async () => {
    await renderApp("/admin/holidays");
    expect(screen.getByText(/has not been rebuilt yet. It arrives in Phase 2/)).toBeTruthy();
  });
});

describe("the employee shell", () => {
  it("shows the employee nav and no admin pages", async () => {
    await renderApp("/employee/leave", "asha@lumiether.test");
    expect(screen.getByRole("heading", { level: 1, name: "My leave" })).toBeTruthy();
    expect(screen.getByText("Asha Rao")).toBeTruthy();
    const n = within(nav());
    expect(n.queryByText("Employees")).toBeNull();
    expect(n.queryByText("Admins")).toBeNull();
    expect(n.getByRole("link", { name: "Holidays" }).getAttribute("href")).toBe("/employee/holidays");
    expect(n.queryByText("Soon")).toBeNull();
  });
});

describe("routing", () => {
  it("sends / to the signed-in user's own home", async () => {
    const router = await renderApp("/");
    expect(router.state.location.pathname).toBe("/admin");
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
  });

  it("shows a not-found page for an unknown address", async () => {
    await renderApp("/nope/nothing");
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });
});

describe("the theme toggle", () => {
  it("switches the dark class on <html> and remembers the choice", async () => {
    await renderApp("/admin");
    const toggle = screen.getByRole("button", { name: "Toggle theme" });
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await userEvent.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");

    await userEvent.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("starts dark when dark was saved", async () => {
    localStorage.setItem("theme", "dark");
    await renderApp("/admin");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("log out and the mobile drawer", () => {
  function shell(onLogout = vi.fn()) {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes>
            <Route element={<AppShell user={{ name: "Priya Sharma", initials: "PS", role: "admin" }} onLogout={onLogout} />}>
              <Route path="/admin/*" element={<p>page body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );
    return onLogout;
  }

  it("calls the log-out handler", async () => {
    const onLogout = shell();
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("renders the page body inside <main>", () => {
    shell();
    expect(within(screen.getByRole("main")).getByText("page body")).toBeTruthy();
  });

  it("opens the same navigation in a drawer, and closes it when you pick a page", async () => {
    shell();
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Leave policy" })).toBeTruthy();
    expect(within(dialog).getAllByText("Soon")).toHaveLength(3);

    await userEvent.click(within(dialog).getByRole("link", { name: "Admins" }));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
