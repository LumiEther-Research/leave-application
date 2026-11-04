# Leave Management App

## Scope
Internal leave management tool for ~5 users. Polished, production-quality UI. Only the features in this file, nothing extra.

## Stack
- Next.js (App Router) + TypeScript + Tailwind CSS
- shadcn/ui for all components. Do not hand-roll tables, dialogs, badges, inputs, or toasts.
- Icons: lucide-react only.
- Database: Neon Postgres via `@neondatabase/serverless` only, accessed from server components and server actions. Tests that touch the database use a Neon test branch in DATABASE_URL_TEST.
- Deploy: Vercel.
- Fonts: Inter (via next/font). Use tabular numbers for all counts and dates.
- Ask before adding any dependency not listed here. Proposed but not yet approved: framer-motion (page and list transitions).

## Roles
- admin: full access. Adds employees, sets joining dates, applies leave for anyone, manages the 4 national holidays (Republic Day Jan 26, Independence Day Aug 15, Gandhi Jayanti Oct 2, Labour Day May 1), approves or rejects leave and comp-off.
- employee: views own balances, applies for leave and comp-off, sees own request status.

## Policy
- Company name: LumiEther Research.
- Accent color: violet-600 (#7C3AED).
- Work week is 5 days. Saturday and Sunday are non-working days.
- Every employee has a category: contractor, employee, intern or student. An admin sets how many leave days a year each category gets; it is not a fixed number.
- Employees are never shown their yearly leave days or how many they have left. They see only the days they have applied for, their comp-off, and the holidays.
- Sick leave counts toward the yearly days.
- Weekends and the 4 national holidays are not deducted from leave.
- Working on a national holiday or a weekend day earns 1 comp-off day (a half day earns half).
- Comp-off is added to the same leave balance as the yearly days.
- Comp-off expires one year after the employee's joining date.
- Leave is deducted from the comp-off that expires soonest first, then from the yearly days.
- A permission is a few hours off on one working day. Employees note it themselves; the admin sees it. It is never deducted from leave.
- The admin approves a comp-off before it is added to the balance.

## Visual direction
- Premium SaaS feel, in the spirit of Linear, Vercel dashboard, and Stripe.
- Palette: neutral zinc scale for surfaces and text. One accent color: violet-600 (#7C3AED), used sparingly for primary actions, active nav, and key highlights.
- Background: very light zinc-50 canvas with white cards. Cards use a 1px zinc-200 border and a soft shadow, with rounded-xl corners.
- Sidebar: white, with a subtle right border. Active item has an accent-tinted background and a left accent bar. Group nav items under small uppercase section labels.
- Header: sticky, blurred background (backdrop-blur), page title on the left, user avatar and role badge on the right.
- Dashboard stat cards: label, large number, small trend or subtext, and an icon in a tinted circle.
- Typography: clear hierarchy. Page title text-2xl semibold, section titles text-base medium with zinc-500 descriptions, body text-sm.
- Spacing: generous, consistent 6 or 8 spacing units between sections. No cramped tables.
- Status badges: pending = amber, approved = emerald, rejected = rose. Always pair color with a text label and a small dot.
- Empty states: centered icon in a tinted circle, a short heading, one sentence of helper text, and a primary action.
- Loading states: every route change shows the running-figure loader (the loading.tsx for each route). Skeletons are only for small in-page sections.
- Error states: inline alert with a retry action.
- Feedback: sonner toast for every create, update, approve, or reject action.
- Motion: subtle only. Fade and slight rise on page load, 150–200ms transitions on hover and focus. Respect prefers-reduced-motion.
- Dark mode: support via a toggle in the header, using next-themes. Design tokens in globals.css so both themes stay consistent.
- Mobile: sidebar becomes a sheet drawer under md breakpoint. Tables collapse into stacked cards on small screens.

## Working rules
- No chart libraries. Draw charts with divs and Tailwind.
- Fetch data in server components.
- Use client components only for buttons, the theme toggle, and the mobile drawer.
- Import individual lucide icons only (`import { Menu } from "lucide-react"`). Never `import *` or dynamic icon lookups.
- No new dependencies without asking.
- Before adding any package, list it and wait for approval.
- Dates in forms (apply-leave and similar) use a native `<input type="date">`. No date-picker or calendar libraries.
- Keep components small and in src/components, grouped by feature (leave/, holidays/, employees/, layout/).
- Put design tokens in one place (globals.css and tailwind config). Do not hardcode colors in components.
- Every screen ships with loading, empty, and error states before it is considered done.
- After each screen, stop and wait for my screenshot feedback.
