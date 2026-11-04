-- Leave days now depend on a category (contractor, employee, intern or student) whose yearly
-- days an admin sets, instead of a fixed 24 on every employee. Also adds short-absence
-- "permissions" (a few hours on one day), which are recorded but never deducted from leave.

create table leave_categories (
  category      text primary key check (category in ('contractor', 'employee', 'intern', 'student')),
  days_per_year integer not null check (days_per_year between 0 and 366)
);

-- split
-- Start every category at the previous fixed 24 days, so nothing changes until an admin sets them.
insert into leave_categories (category, days_per_year) values
  ('contractor', 24), ('employee', 24), ('intern', 24), ('student', 24);

-- split
alter table employees add column category text not null default 'employee' references leave_categories (category);

-- split
-- The per-employee allowance is replaced by the category's days.
alter table employees drop column leave_allowance;

-- split
create table permissions (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees (id) on delete cascade,
  permission_date date not null,
  start_time      time not null,
  end_time        time not null,
  reason          text not null default '' check (char_length(reason) <= 200),
  created_at      timestamptz not null default now(),
  check (end_time > start_time),
  check (end_time - start_time <= interval '8 hours')
);

-- split
create index permissions_employee_idx on permissions (employee_id, permission_date);
