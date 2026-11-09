import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { navByRole, type Role } from "./nav-config";

const itemBase =
  "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** `active` is the href of the current page, passed down by the page itself. */
export function SidebarNav({ role, active }: { role: Role; active: string }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {navByRole[role].map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            {section.label}
          </p>
          {section.items.map(({ label, href, icon: Icon, ready }) => {
            if (!ready) {
              return (
                <span key={href} aria-disabled="true" className={cn(itemBase, "cursor-default text-muted-foreground")}>
                  <Icon className="size-4" aria-hidden />
                  {label}
                  <Badge variant="secondary" className="ml-auto h-4 px-1.5 text-[10px] tracking-wide uppercase">
                    Soon
                  </Badge>
                </span>
              );
            }
            const isActive = active === href;
            return (
              <Link
                key={href}
                to={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  itemBase,
                  isActive
                    ? "bg-primary-subtle text-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                {isActive && (
                  <span aria-hidden className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
                )}
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
