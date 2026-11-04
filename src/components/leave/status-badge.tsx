import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const styles = {
  pending: { label: "Pending", badge: "bg-pending-surface text-pending", dot: "bg-pending-dot" },
  approved: { label: "Approved", badge: "bg-approved-surface text-approved", dot: "bg-approved-dot" },
  rejected: { label: "Rejected", badge: "bg-rejected-surface text-rejected", dot: "bg-rejected-dot" },
  cancelled: { label: "Cancelled", badge: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
  /** approved leave with a cancellation waiting for an admin */
  cancelling: { label: "Cancellation pending", badge: "bg-pending-surface text-pending", dot: "bg-pending-dot" },
} as const;

export type LeaveStatus = keyof typeof styles;

export function StatusBadge({ status, className }: { status: LeaveStatus; className?: string }) {
  const s = styles[status];
  return (
    <Badge variant="secondary" className={cn("gap-1.5", s.badge, className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </Badge>
  );
}
