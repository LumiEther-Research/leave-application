import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MobileNav } from "./mobile-nav";
import { getPageTitle, roleLabel, type Role } from "./nav-config";
import { ThemeToggle } from "./theme-toggle";

export type ShellUser = { name: string; initials: string; role: Role };

export function Header({ user, active, onLogout }: { user: ShellUser; active: string; onLogout: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 md:px-8">
      <MobileNav role={user.role} active={active} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{getPageTitle(user.role, active)}</h1>
      </div>
      <ThemeToggle />
      <div className="flex items-center gap-3 pl-1">
        <Avatar>
          <AvatarFallback className="bg-primary-subtle text-xs font-medium text-primary">{user.initials}</AvatarFallback>
        </Avatar>
        <div className="hidden flex-col items-start gap-0.5 sm:flex">
          <span className="text-sm leading-none font-medium">{user.name}</span>
          <Badge variant="secondary" className="h-4 px-1.5 text-[11px]">
            {roleLabel[user.role]}
          </Badge>
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" aria-label="Log out" onClick={onLogout}>
        <LogOut aria-hidden />
        <span className="hidden sm:inline">Log out</span>
      </Button>
    </header>
  );
}
