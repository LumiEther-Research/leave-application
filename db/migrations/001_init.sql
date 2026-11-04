-- LumiEther leave management: initial schema.
-- Statements are separated by a line containing only "-- split", because the Neon
-- HTTP driver runs one statement per query. scripts/migrate.mjs applies the file
-- in a single transaction and records it in schema_migrations.

create table admins (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- split
create unique index admins_email_key on admins (lower(email));

-- split
create table employees (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null,
  password_hash   text not null,
  leave_allowance integer not null default 24 check (leave_allowance >= 0),
  joining_date    date not null,
  created_at      timestamptz not null default now()
);

-- split
create unique index employees_email_key on employees (lower(email));

-- split
-- The company-wide national holidays. They repeat every year, so only month and day are stored.
create table holidays (
  id    serial primary key,
  name  text not null,
  month smallint not null check (month between 1 and 12),
  day   smallint not null check (day between 1 and 31),
  unique (month, day)
);

-- split
insert into holidays (name, month, day) values
  ('Republic Day', 1, 26),
  ('Labour Day', 5, 1),
  ('Independence Day', 8, 15),
  ('Gandhi Jayanti', 10, 2);

-- split
-- Casual and sick leave. A half day is a single day with half_day = true.
-- status 'cancelled' means withdrawn while pending, or cancelled after approval.
-- cancel_requested marks approved leave whose cancellation is waiting for an admin.
create table leave_requests (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references employees (id) on delete cascade,
  type                text not null check (type in ('Casual leave', 'Sick leave')),
  status              text not null check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  from_date           date not null,
  to_date             date not null,
  half_day            boolean not null default false,
  cancel_requested    boolean not null default false,
  cancel_requested_on date,
  applied_on          date not null,
  created_at          timestamptz not null default now(),
  check (to_date >= from_date),
  check (not half_day or from_date = to_date),
  check (not cancel_requested or status = 'approved')
);

-- split
create index leave_requests_employee_idx on leave_requests (employee_id);

-- split
-- Claims for working a weekend or national holiday. Approved claims add to the leave balance.
create table comp_off_claims (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  worked_on   date not null,
  half_day    boolean not null default false,
  status      text not null check (status in ('pending', 'approved', 'rejected')),
  applied_on  date not null,
  created_at  timestamptz not null default now()
);

-- split
-- One live claim per employee per day. A rejected claim can be made again.
create unique index comp_off_claims_live_key on comp_off_claims (employee_id, worked_on) where status <> 'rejected';

-- split
create index comp_off_claims_employee_idx on comp_off_claims (employee_id);

-- split
-- The last admin can never be deleted, even by direct SQL. The advisory lock makes two
-- concurrent deletes take turns, so each one sees the other's result before it counts.
create function keep_one_admin() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('lumiether.admins.keep_one'));
  if (select count(*) from admins) <= 1 then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

-- split
create trigger admins_keep_one before delete on admins for each row execute function keep_one_admin();
