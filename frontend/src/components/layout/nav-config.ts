import {
  CalendarClock,
  CalendarDays,
  FileText,
  Flag,
  Clock,
  KeyRound,
  LayoutDashboard,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

export type Role = "admin" | "employee";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** false until the screen is built, so we never link to a 404 */
  ready: boolean;
};

export type NavSection = { label: string; items: NavItem[] };

export const navByRole: Record<Role, NavSection[]> = {
  admin: [
    {
      label: "Overview",
      items: [{ label: "Dashboard", href: "/admin", icon: LayoutDashboard, ready: true }],
    },
    {
      label: "Leave",
      items: [
        { label: "Leave requests", href: "/admin/leave", icon: CalendarDays, ready: true },
        { label: "Comp-off", href: "/admin/comp-off", icon: CalendarClock, ready: true },
        { label: "Permissions", href: "/admin/permissions", icon: Clock, ready: true },
      ],
    },
    {
      label: "Company",
      items: [
        { label: "Employees", href: "/admin/employees", icon: Users, ready: true },
        { label: "Admins", href: "/admin/admins", icon: ShieldCheck, ready: true },
        { label: "Leave policy", href: "/admin/leave-policy", icon: SlidersHorizontal, ready: true },
        { label: "Holidays", href: "/admin/holidays", icon: Flag, ready: true },
      ],
    },
    {
      label: "Payroll",
      items: [{ label: "Payslips", href: "/admin/payslips", icon: FileText, ready: true }],
    },
    {
      label: "Account",
      items: [{ label: "Change password", href: "/admin/password", icon: KeyRound, ready: true }],
    },
  ],
  employee: [
    {
      label: "Overview",
      items: [{ label: "Dashboard", href: "/employee", icon: LayoutDashboard, ready: true }],
    },
    {
      label: "Requests",
      items: [
        { label: "My leave", href: "/employee/leave", icon: CalendarDays, ready: true },
        { label: "Comp-off", href: "/employee/comp-off", icon: CalendarClock, ready: true },
        { label: "Permissions", href: "/employee/permissions", icon: Clock, ready: true },
      ],
    },
    {
      label: "Company",
      items: [{ label: "Holidays", href: "/employee/holidays", icon: Flag, ready: true }],
    },
    {
      label: "Payroll",
      items: [{ label: "Payslips", href: "/employee/payslips", icon: FileText, ready: true }],
    },
    {
      label: "Account",
      items: [{ label: "Change password", href: "/employee/password", icon: KeyRound, ready: true }],
    },
  ],
};

export const roleLabel: Record<Role, string> = { admin: "Admin", employee: "Employee" };

export function getPageTitle(role: Role, pathname: string): string {
  const items = navByRole[role].flatMap((s) => s.items);
  return items.find((i) => i.href === pathname)?.label ?? "Dashboard";
}
