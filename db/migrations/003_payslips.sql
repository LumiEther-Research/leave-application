-- Payslips. Adds a generated employee code, a monthly salary and a designation to employees,
-- and a payslips table that keeps each month's rendered PDF.
-- Statements are separated by a line containing only "-- split" (see scripts/migrate.mjs).

-- Employee codes look like HR-EMP-00001. A sequence hands them out, so they are unique and never reused.
create sequence employee_code_seq;

-- split
alter table employees add column employee_code text;

-- split
-- Existing employees get codes in the order they were added.
update employees e set employee_code = 'HR-EMP-' || lpad(n.rn::text, 5, '0')
from (select id, row_number() over (order by created_at, id) as rn from employees) n
where n.id = e.id;

-- split
select setval('employee_code_seq', greatest((select count(*) from employees), 1), (select count(*) > 0 from employees));

-- split
alter table employees alter column employee_code set default 'HR-EMP-' || lpad(nextval('employee_code_seq')::text, 5, '0');

-- split
alter table employees alter column employee_code set not null;

-- split
alter table employees add constraint employees_employee_code_key unique (employee_code);

-- split
alter table employees add column monthly_salary numeric(12, 2) check (monthly_salary is null or monthly_salary >= 0);

-- split
-- Shown on the payslip. The employee record had no designation column.
alter table employees add column designation text;

-- split
create table payslips (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees (id) on delete cascade,
  period_month    date not null check (extract(day from period_month) = 1),
  basic           numeric(12, 2) not null check (basic >= 0),
  deduction       numeric(12, 2) not null default 0 check (deduction >= 0),
  net             numeric(12, 2) not null,
  amount_in_words text not null,
  pdf             bytea not null,
  generated_at    timestamptz not null default now(),
  unique (employee_id, period_month),
  check (deduction <= basic),
  check (net = basic - deduction)
);

-- split
create index payslips_period_idx on payslips (period_month);
