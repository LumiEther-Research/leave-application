import { Header, type ShellUser } from "./header";
import { PageTransition } from "./page-transition";
import { Sidebar } from "./sidebar";

/** Rendered by each page, which passes its own href as `active`. */
export function AppShell({
  user,
  active,
  children,
}: {
  user: ShellUser;
  active: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar role={user.role} active={active} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} active={active} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
