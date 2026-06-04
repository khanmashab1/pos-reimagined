-- Daily Expenses Report.
-- Stores only the RAW daily inputs; the derived fields (Previous Expense, Grand
-- Expenses, Total Cash, Grand Total, Previous Total, Profit, Sale) are computed in
-- the app from the date-ordered rows so editing a past date recalculates the chain.

create table if not exists public.daily_expenses (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  cash_junaid numeric not null default 0,
  cash_usama numeric not null default 0,
  others numeric not null default 0,
  counter_cash numeric not null default 0,
  today_expenses numeric not null default 0,
  created_by uuid,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Drop the cash_zahid_ali column if an earlier version of this table was created with it.
alter table public.daily_expenses drop column if exists cash_zahid_ali;

create index if not exists daily_expenses_entry_date_idx on public.daily_expenses(entry_date);

alter table public.daily_expenses enable row level security;

-- Admin-only (this is an admin report page)
drop policy if exists "daily_expenses admin all" on public.daily_expenses;
create policy "daily_expenses admin all" on public.daily_expenses
  for all using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

notify pgrst, 'reload schema';
