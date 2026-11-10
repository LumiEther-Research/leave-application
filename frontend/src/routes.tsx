import { Link, Outlet, redirect, useLoaderData, useNavigate, useNavigation, type RouteObject } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { PageError, ShellError } from "@/components/layout/route-error";
import { RunnerLoader } from "@/components/layout/runner-loader";
import { navByRole, type NavItem } from "@/components/layout/nav-config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { currentUser, homeFor, send, type Role, type SessionUser } from "@/lib/api";
import { initialsOf } from "@/lib/initials";
import { AdminsPage, adminsLoader } from "@/pages/admins";
import { ChangePasswordPage } from "@/pages/change-password";
import { AdminDashboardPage, adminDashboardLoader } from "@/pages/admin-dashboard";
import { EmployeeDashboardPage, employeeDashboardLoader } from "@/pages/employee-dashboard";
import { EmployeesPage, employeesLoader } from "@/pages/employees";
import { HolidaysPage, holidaysLoader } from "@/pages/holidays";
import { LeavePolicyPage, leavePolicyLoader } from "@/pages/leave-policy";
import { AdminPermissionsPage, MyPermissionsPage, adminPermissionsLoader, myPermissionsLoader } from "@/pages/permissions";
import {
  AdminCompOffPage, AdminLeavePage, MyCompOffPage, MyLeavePage,
  adminCompOffLoader, adminLeaveLoader, myCompOffLoader, myLeaveLoader,
} from "@/pages/requests";
import { LoginPage } from "@/pages/login";

/** Which phase of docs/rebuild-plan.md brings each screen. */
export function phaseFor(item: NavItem): string {
  if (/\/(employees|leave-policy|holidays)$/.test(item.href)) return "Phase 2";
  if (/\/(payslips)$/.test(item.href)) return "Phase 4";
  return "Phase 3";
}

function Placeholder({ item }: { item: NavItem }) {
  return (
    <Card className="max-w-lg [--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>{item.label}</CardTitle>
        <CardDescription>This screen has not been rebuilt yet. It arrives in {phaseFor(item)}.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Only the shell (sidebar, header, theme toggle, mobile drawer) is built so far.
      </CardContent>
    </Card>
  );
}

function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-base font-medium">Page not found</p>
      <p className="text-sm text-muted-foreground">There is nothing at this address.</p>
      <Link to="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        Go to the start
      </Link>
    </main>
  );
}

/** Every route change shows the running-figure loader (the current app's loading.tsx). Saving a form only revalidates, so it never flashes it. */
function Root() {
  const navigation = useNavigation();
  return navigation.state === "loading" ? <RunnerLoader /> : <Outlet />;
}

/** Signed out goes to /login. The wrong role goes to its own home, as requireRole does in the current app. */
function shellLoader(role: Role) {
  return async (): Promise<SessionUser> => {
    const user = await currentUser();
    if (!user) throw redirect("/login");
    if (user.role !== role) throw redirect(homeFor(user.role));
    return user;
  };
}

function Shell() {
  const user = useLoaderData() as SessionUser;
  const navigate = useNavigate();
  async function logout() {
    try {
      await send("POST", "/api/auth/logout"); // the server expires the HttpOnly cookie
    } finally {
      navigate("/login", { replace: true });
    }
  }
  return <AppShell user={{ name: user.name, initials: initialsOf(user.name), role: user.role }} onLogout={logout} />;
}

/** The pages that are built. Everything else in the nav is still a placeholder. */
const built: Record<string, Pick<RouteObject, "element" | "loader">> = {
  "/admin/admins": { element: <AdminsPage />, loader: adminsLoader },
  "/admin": { element: <AdminDashboardPage />, loader: adminDashboardLoader },
  "/admin/leave": { element: <AdminLeavePage />, loader: adminLeaveLoader },
  "/admin/comp-off": { element: <AdminCompOffPage />, loader: adminCompOffLoader },
  "/admin/permissions": { element: <AdminPermissionsPage />, loader: adminPermissionsLoader },
  "/admin/employees": { element: <EmployeesPage />, loader: employeesLoader },
  "/admin/leave-policy": { element: <LeavePolicyPage />, loader: leavePolicyLoader },
  "/admin/holidays": { element: <HolidaysPage />, loader: holidaysLoader("/employee") },
  "/employee": { element: <EmployeeDashboardPage />, loader: employeeDashboardLoader },
  "/employee/leave": { element: <MyLeavePage />, loader: myLeaveLoader },
  "/employee/comp-off": { element: <MyCompOffPage />, loader: myCompOffLoader },
  "/employee/permissions": { element: <MyPermissionsPage />, loader: myPermissionsLoader },
  "/employee/holidays": { element: <HolidaysPage />, loader: holidaysLoader("/admin") },
  "/admin/password": { element: <ChangePasswordPage /> },
  "/employee/password": { element: <ChangePasswordPage /> },
};

function shellRoute(role: Role): RouteObject {
  const items = navByRole[role].flatMap((section) => section.items);
  return {
    id: "shell-" + role,
    path: `/${role}`,
    loader: shellLoader(role),
    element: <Shell />,
    errorElement: <ShellError />,
    children: items.map((item) => {
      const page = built[item.href] ?? { element: <Placeholder item={item} /> };
      return item.href === `/${role}`
        ? { index: true, ...page, errorElement: <PageError /> }
        : { path: item.href.slice(`/${role}/`.length), ...page, errorElement: <PageError /> };
    }),
  };
}

export const appRoutes: RouteObject[] = [
  {
    element: <Root />,
    errorElement: <ShellError />,
    HydrateFallback: RunnerLoader,
    children: [
      {
        path: "/",
        loader: async () => {
          const user = await currentUser();
          throw redirect(user ? homeFor(user.role) : "/login");
        },
      },
      {
        path: "/login",
        element: <LoginPage />,
        // Already signed in? Skip the form.
        loader: async () => {
          const user = await currentUser();
          if (user) throw redirect(homeFor(user.role));
          return null;
        },
      },
      shellRoute("admin"),
      shellRoute("employee"),
      { path: "*", element: <NotFound /> },
    ],
  },
];
