import { StatCard, type StatCardProps } from "./stat-card";

// Full class names so Tailwind can see them. Rows fill evenly for 3 or 4 cards.
const columns: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "md:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
};

export function StatGrid({ stats }: { stats: StatCardProps[] }) {
  return (
    <div className={`grid gap-4 ${columns[stats.length] ?? columns[4]}`}>
      {stats.map((s) => (
        <StatCard key={s.label} {...s} />
      ))}
    </div>
  );
}
