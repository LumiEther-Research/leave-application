import { Link, Navigate, type RouteObject } from "react-router-dom";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import type { ShellUser } from "@/components/layout/header";
import { navByRole, type NavItem, type Role } from "@/components/layout/nav-config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { initialsOf } from "@/lib/initials";

/** Which phase of docs/rebuild-plan.md brings each screen. */
export function phaseFor(item: NavItem): string {
  if (/\/(admins|password)$/.test(item.href)) return "Phase 1b, right after the login screen";
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

/**
 * Until the login screen exists there is no signed-in user, so the shell is shown to a stand-in user, in development
 * only. A production build refuses, so a deployed site can never show an admin-looking screen to anyone.
 */
function previewUser(role: Role): ShellUser {
  const name = role === "admin" ? "Preview Admin" : "Preview Employee";
  return { name, initials: initialsOf(name), role };
}

function PreviewShell({ role }: { role: Role }) {
  if (!import.meta.env.DEV) return <NotFound />;
  return <AppShell user={previewUser(role)} onLogout={() => toast("Signing out is not wired up yet", { description: "It arrives with the login screen." })} />;
}

function shellRoute(role: Role): RouteObject {
  const items = navByRole[role].flatMap((section) => section.items);
  return {
    path: `/${role}`,
    element: <PreviewShell role={role} />,
    children: items.map((item) =>
      item.href === `/${role}`
        ? { index: true, element: <Placeholder item={item} /> }
        : { path: item.href.slice(`/${role}/`.length), element: <Placeholder item={item} /> },
    ),
  };
}

export const appRoutes: RouteObject[] = [
  { path: "/", element: <Navigate to="/admin" replace /> },
  shellRoute("admin"),
  shellRoute("employee"),
  { path: "*", element: <NotFound /> },
];
