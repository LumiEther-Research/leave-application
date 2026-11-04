import { plural } from "@/lib/leave";
import { GreetingHeader } from "./greeting-header";

const strong = "font-medium text-foreground tabular-nums";

export function AdminGreeting({
  name,
  hour,
  today,
  pendingCount,
  outTodayCount,
}: {
  name: string;
  hour: number;
  today: Date;
  pendingCount: number;
  outTodayCount: number;
}) {
  return (
    <GreetingHeader name={name} today={today} hour={hour}>
      {pendingCount > 0 ? (
        <>
          <span className={strong}>{plural(pendingCount, "request")}</span> waiting for your decision
        </>
      ) : (
        "No requests waiting for your decision"
      )}
      {", and "}
      {outTodayCount > 0 ? (
        <>
          <span className={strong}>{plural(outTodayCount, "person", "people")}</span>{" "}
          {outTodayCount === 1 ? "is" : "are"} out today.
        </>
      ) : (
        "nobody is out today."
      )}
    </GreetingHeader>
  );
}
