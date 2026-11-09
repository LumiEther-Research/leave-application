import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";
import type { Role } from "./nav-config";

export function Sidebar({ role, active }: { role: Role; active: string }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-16 items-center border-b border-sidebar-border px-5">
        <Brand />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-6">
        <SidebarNav role={role} active={active} />
      </div>
    </aside>
  );
}
