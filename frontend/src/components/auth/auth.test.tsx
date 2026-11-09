import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { appRoutes } from "@/routes";
import { FakeBackend } from "@/test/fake-backend";

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

afterEach(() => vi.unstubAllGlobals());

const email = () => screen.getByLabelText("Email") as HTMLInputElement;
const password = () => screen.getByLabelText("Password") as HTMLInputElement;
const FAILED = "Incorrect email or password.";

async function signInWith(e: string, p: string) {
  await userEvent.clear(email());
  await userEvent.type(email(), e);
  await userEvent.type(password(), p);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("the login screen", () => {
  it("shows the brand, the card and the form", async () => {
    await renderApp("/login", new FakeBackend());
    expect(screen.getByRole("img", { name: "LumiEther Research" })).toBeTruthy();
    expect(screen.getByText("Sign in", { selector: "[data-slot=card-title]" })).toBeTruthy();
    expect(screen.getByText("Use the email and password your admin gave you.")).toBeTruthy();
    expect(email().type).toBe("email");
    expect(password().type).toBe("password");
    expect(document.activeElement).toBe(email());
  });

  it("sets the tab title like the current app", async () => {
    await renderApp("/login", new FakeBackend());
    expect(document.title).toBe("Sign in · Leave Management");
  });

  it("signs an admin in and lands on /admin, an employee on /employee", async () => {
    const admin = await renderApp("/login", new FakeBackend());
    await signInWith("priya@lumiether.test", "correct-horse");
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
    expect(admin.state.location.pathname).toBe("/admin");
    expect(within(screen.getByRole("banner")).getByText("Priya Sharma")).toBeTruthy();
  });

  it("sends an employee to /employee", async () => {
    const router = await renderApp("/login", new FakeBackend());
    await signInWith("asha@lumiether.test", "employee-pass");
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/employee");
  });

  it("posts the credentials with credentials: include and a JSON body, and never reads or stores a token", async () => {
    const backend = new FakeBackend();
    await renderApp("/login", backend);
    await signInWith("priya@lumiether.test", "correct-horse");
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    const [login] = backend.callsTo("POST", "/api/auth/login");
    expect(login.credentials).toBe("include");
    expect(login.headers["Content-Type"]).toBe("application/json");
    expect(login.body).toEqual({ email: "priya@lumiether.test", password: "correct-horse" });
    // every request to the backend carries the cookie
    expect(backend.calls.every((c) => c.credentials === "include")).toBe(true);
    // nothing about the session reaches script-visible storage
    expect(Object.keys(localStorage).filter((k) => k !== "theme")).toEqual([]);
    expect(Object.keys(sessionStorage)).toEqual([]);
    expect(document.cookie).toBe("");
  });

  it.each([
    ["a wrong password", "priya@lumiether.test", "nope-nope-nope"],
    ["an unknown email", "nobody@lumiether.test", "correct-horse"],
  ])("says only %s is incorrect, in the same words", async (_name, e, p) => {
    await renderApp("/login", new FakeBackend());
    await signInWith(e, p);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(FAILED);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(email().value).toBe(e); // the email stays
    expect(password().value).toBe(""); // the password doesn't
  });

  it("uses the generic message for a network failure during sign-in", async () => {
    const backend = new FakeBackend();
    await renderApp("/login", backend);
    backend.down = true;
    await signInWith("priya@lumiether.test", "correct-horse");
    expect((await screen.findByRole("alert")).textContent).toBe(FAILED);
  });

  it("uses the generic message for a 500", async () => {
    const backend = new FakeBackend();
    await renderApp("/login", backend);
    backend.forced["/api/auth/login"] = 500;
    await signInWith("priya@lumiether.test", "correct-horse");
    expect((await screen.findByRole("alert")).textContent).toBe(FAILED);
  });

  it("shows the running-figure loader while the request runs, and the button says so", async () => {
    const backend = new FakeBackend();
    await renderApp("/login", backend);
    backend.hold();
    await userEvent.type(email(), "priya@lumiether.test");
    await userEvent.type(password(), "correct-horse");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect((screen.getByRole("button", { name: "Signing in…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => backend.release());
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
  });

  it("does not send a second request while one is running", async () => {
    const backend = new FakeBackend();
    await renderApp("/login", backend);
    backend.hold();
    await userEvent.type(email(), "priya@lumiether.test");
    await userEvent.type(password(), "correct-horse");
    const form = screen.getByRole("button", { name: "Sign in" }).closest("form")!;
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    form.requestSubmit();
    expect(backend.callsTo("POST", "/api/auth/login")).toHaveLength(1);
    await act(async () => backend.release());
  });

  it("skips the form when you are already signed in", async () => {
    const router = await renderApp("/login", new FakeBackend().signIn("priya@lumiether.test"));
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    expect(router.state.location.pathname).toBe("/admin");
  });
});

describe("the redirect to /login", () => {
  it.each(["/admin", "/admin/admins", "/admin/password", "/employee", "/employee/leave"])("sends %s to /login when there is no session", async (path) => {
    const router = await renderApp(path, new FakeBackend());
    expect(await screen.findByText("Use the email and password your admin gave you.")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/login");
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });

  it("sends / to /login when signed out", async () => {
    const router = await renderApp("/", new FakeBackend());
    await screen.findByText("Sign in", { selector: "[data-slot=card-title]" });
    expect(router.state.location.pathname).toBe("/login");
  });

  it("sends an employee who opens an admin page to their own home; the backend refuses the admin list with 403", async () => {
    const backend = new FakeBackend().signIn("asha@lumiether.test");
    const router = await renderApp("/admin/admins", backend);
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    expect(router.state.location.pathname).toBe("/employee");
    expect(screen.queryByText("Ravi Kumar")).toBeNull(); // no admin data reached the page
    expect(screen.queryByRole("link", { name: "Admins" })).toBeNull();
  });

  it("logs out through the server and returns to /login, and a back-navigation does not show the page", async () => {
    const backend = new FakeBackend().signIn("priya@lumiether.test");
    const router = await renderApp("/admin", backend);
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await screen.findByText("Sign in", { selector: "[data-slot=card-title]" });
    expect(backend.callsTo("POST", "/api/auth/logout")).toHaveLength(1);
    expect(backend.callsTo("POST", "/api/auth/logout")[0].headers["Content-Type"]).toBe("application/json"); // the CSRF guard needs it
    expect(backend.signedInAs).toBeNull(); // the server really ended the session
    expect(router.state.location.pathname).toBe("/login");
    await act(async () => void router.navigate("/admin"));
    await screen.findByText("Sign in", { selector: "[data-slot=card-title]" });
    expect(router.state.location.pathname).toBe("/login");
  });

  it("shows an inline error with Retry when the session check can't reach the server, then recovers", async () => {
    const backend = new FakeBackend().signIn("priya@lumiether.test");
    backend.down = true;
    await renderApp("/admin", backend);
    expect(await screen.findByText("Something went wrong")).toBeTruthy();
    backend.down = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
  });

  it("shows the running-figure loader while the first page is being fetched", async () => {
    const backend = new FakeBackend().signIn("priya@lumiether.test");
    backend.hold();
    backend.install();
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/admin"] });
    render(
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain("Loading");
    await act(async () => backend.release());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy());
  });
});
