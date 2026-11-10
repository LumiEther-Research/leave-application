import { Download, FileText } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PayslipRow } from "@/lib/api";
import { formatDate, parseISO } from "@/lib/dates";
import { formatInr, monthLabel } from "@/lib/money";
import { PublishButton } from "./publish-button";

const generatedOn = (iso: string) => formatDate(parseISO(iso), "d MMM yyyy");

function DownloadLink({ id, label }: { id: string; label: string }) {
  // A plain link: the browser sends the session cookie with it, and the backend decides who may have the file.
  return (
    <a href={`/api/payslips/${id}/pdf`} download aria-label={label} className={buttonVariants({ variant: "outline", size: "sm" })}>
      <Download aria-hidden />
      Download
    </a>
  );
}

/** Admin only: a draft is waiting to be published, anything else is visible to the employee. */
function PublishState({ published }: { published: boolean }) {
  return published ? (
    <Badge variant="secondary" className="gap-1.5 bg-approved-surface text-approved">
      <span aria-hidden className="size-1.5 rounded-full bg-approved-dot" />
      Published
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1.5 bg-pending-surface text-pending">
      <span aria-hidden className="size-1.5 rounded-full bg-pending-dot" />
      Draft
    </Badge>
  );
}

function Actions({ p, showEmployee, onChanged }: { p: PayslipRow; showEmployee: boolean; onChanged: () => void }) {
  const month = monthLabel(p.periodMonth);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {showEmployee && !p.published && <PublishButton id={p.id} name={p.employeeName} month={month} onDone={onChanged} />}
      <DownloadLink id={p.id} label={`Download ${month} payslip for ${p.employeeName}`} />
    </div>
  );
}

/** Payslips with download links. The admin's copy shows whose each one is; an employee's shows the month. */
export function PayslipList({
  payslips,
  showEmployee,
  title,
  description,
  emptyTitle,
  emptyDescription,
  onChanged = () => {},
}: {
  payslips: PayslipRow[];
  showEmployee: boolean;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  onChanged?: () => void;
}) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {payslips.length === 0 ? (
          <EmptyState icon={FileText} title={emptyTitle} description={emptyDescription} />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {showEmployee && <TableHead className="h-11">Employee</TableHead>}
                    <TableHead className="h-11">Month</TableHead>
                    <TableHead className="h-11 text-right">Basic</TableHead>
                    <TableHead className="h-11 text-right">Deduction</TableHead>
                    <TableHead className="h-11 text-right">Net pay</TableHead>
                    <TableHead className="h-11">Generated</TableHead>
                    {showEmployee && <TableHead className="h-11">Status</TableHead>}
                    <TableHead className="h-11 text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.map((p) => (
                    <TableRow key={p.id}>
                      {showEmployee && (
                        <TableCell className="py-3">
                          <span className="font-medium">{p.employeeName}</span>
                          <span className="block text-xs text-muted-foreground tabular-nums">{p.employeeCode}</span>
                        </TableCell>
                      )}
                      <TableCell className="py-3 tabular-nums">{monthLabel(p.periodMonth)}</TableCell>
                      <TableCell className="py-3 text-right tabular-nums">{formatInr(p.basic)}</TableCell>
                      <TableCell className="py-3 text-right text-muted-foreground tabular-nums">{formatInr(p.deduction)}</TableCell>
                      <TableCell className="py-3 text-right font-medium tabular-nums">{formatInr(p.net)}</TableCell>
                      <TableCell className="py-3 text-muted-foreground tabular-nums">{generatedOn(p.generatedOn)}</TableCell>
                      {showEmployee && (
                        <TableCell className="py-3">
                          <PublishState published={p.published} />
                        </TableCell>
                      )}
                      <TableCell className="py-3 text-right">
                        <Actions p={p} showEmployee={showEmployee} onChanged={onChanged} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="flex flex-col gap-3 md:hidden">
              {payslips.map((p) => (
                <li key={p.id} className="flex flex-col gap-3 rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{showEmployee ? p.employeeName : monthLabel(p.periodMonth)}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {showEmployee && `${p.employeeCode} · ${monthLabel(p.periodMonth)}`}
                        {!showEmployee && `Generated ${generatedOn(p.generatedOn)}`}
                      </p>
                    </div>
                    <p className="text-sm font-medium tabular-nums">{formatInr(p.net)}</p>
                  </div>
                  {showEmployee && <PublishState published={p.published} />}
                  <Actions p={p} showEmployee={showEmployee} onChanged={onChanged} />
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
