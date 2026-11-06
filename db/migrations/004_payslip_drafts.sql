-- Payslips the monthly job creates start as drafts: only the admin sees them until they are published.
-- Everything that exists already (and anything an admin generates by hand) is published.
alter table payslips add column published boolean not null default true;
