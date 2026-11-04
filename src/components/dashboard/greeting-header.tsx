import { formatDate } from "@/lib/dates";

export function GreetingHeader({
  name,
  today,
  hour,
  children,
}: {
  name: string;
  today: Date;
  hour: number;
  /** summary line */
  children: React.ReactNode;
}) {
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium text-muted-foreground tabular-nums">{formatDate(today, "EEEE, d MMMM yyyy")}</p>
      <h2 className="text-xl font-semibold tracking-tight">
        {greeting}, {name}
      </h2>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
