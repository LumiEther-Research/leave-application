import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const tones = {
  default: "bg-primary-subtle text-primary",
  pending: "bg-pending-surface text-pending",
  approved: "bg-approved-surface text-approved",
  rejected: "bg-rejected-surface text-rejected",
} as const;

const sentiments = {
  positive: "text-approved",
  negative: "text-rejected",
  neutral: "text-muted-foreground",
} as const;

const trendIcons = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

export type StatTrend = {
  direction: keyof typeof trendIcons;
  /** e.g. "+1" or "No change" */
  value: string;
  /** what it is compared against, e.g. "vs last week" */
  label: string;
  /** whether this movement is good news, bad news, or neither */
  sentiment: keyof typeof sentiments;
};

export type StatCardProps = {
  label: string;
  value: string | number;
  subtext: string;
  icon: LucideIcon;
  tone?: keyof typeof tones;
  trend?: StatTrend;
};

export function StatCard({ label, value, subtext, icon: Icon, tone = "default", trend }: StatCardProps) {
  const TrendIcon = trend ? trendIcons[trend.direction] : null;

  return (
    <Card className="[--card-spacing:--spacing(5)] transition-shadow duration-200 hover:shadow-md">
      <CardContent className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{subtext}</p>
          {trend && TrendIcon && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
              <span className={cn("inline-flex items-center gap-1 font-medium", sentiments[trend.sentiment])}>
                <TrendIcon className="size-3.5" aria-hidden />
                {trend.value}
              </span>
              <span>{trend.label}</span>
            </p>
          )}
        </div>
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", tones[tone])}>
          <Icon className="size-5" aria-hidden />
        </div>
      </CardContent>
    </Card>
  );
}
