import { Outlet, useLocation } from "react-router-dom";
import { Header, type ShellUser } from "./header";
import { PageTransition } from "./page-transition";
import { Sidebar } from "./sidebar";

/** The layout route for a signed-in user: sidebar, sticky header, and the page in <main>. The active nav item comes from the URL. */
export function AppShell({ user, onLogout }: { user: ShellUser; onLogout: () => void }) {
  const { pathname } = useLocation();
  const active = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  return (
    <div className="flex min-h-screen">
      <Sidebar role={user.role} active={active} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} active={active} onLogout={onLogout} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>
    </div>
  );
}
