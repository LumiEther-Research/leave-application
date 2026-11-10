import { useLoaderData } from "react-router-dom";
import { AdminRequestsCard } from "@/components/leave/admin-requests-card";
import { ApplyLeaveForm } from "@/components/leave/apply-leave-form";
import { ClaimCompOffForm } from "@/components/leave/claim-comp-off-form";
import { MyRequestsCard } from "@/components/leave/my-requests-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { load, type RequestRow } from "@/lib/api";

type Loaded = { requests: RequestRow[] };

export const myLeaveLoader = () => load<Loaded>("/api/employee/leave", "/admin");
export const myCompOffLoader = () => load<Loaded>("/api/employee/comp-off", "/admin");
export const adminLeaveLoader = () => load<Loaded>("/api/admin/leave", "/employee");
export const adminCompOffLoader = () => load<Loaded>("/api/admin/comp-off", "/employee");

export function MyLeavePage() {
  const { requests } = useLoaderData() as Loaded;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <MyRequestsCard kind="leave" requests={requests} />
      </div>
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>Request leave</CardTitle>
          <CardDescription>Casual or sick leave, for a full day, several days or a half day.</CardDescription>
        </CardHeader>
        <CardContent>
          <ApplyLeaveForm />
        </CardContent>
      </Card>
    </div>
  );
}

export function MyCompOffPage() {
  const { requests } = useLoaderData() as Loaded;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <MyRequestsCard kind="comp-off" requests={requests} />
      </div>
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>Request comp-off</CardTitle>
          <CardDescription>Working a weekend or a national holiday earns 1 day (half a day for half a day&apos;s work).</CardDescription>
        </CardHeader>
        <CardContent>
          <ClaimCompOffForm />
        </CardContent>
      </Card>
    </div>
  );
}

export function AdminLeavePage() {
  const { requests } = useLoaderData() as Loaded;
  return <AdminRequestsCard kind="leave" requests={requests} />;
}

export function AdminCompOffPage() {
  const { requests } = useLoaderData() as Loaded;
  return <AdminRequestsCard kind="comp-off" requests={requests} />;
}
