-- Operating expenses (rent, bills, salaries, etc.) — distinct from supplier purchases
-- (which are inventory investment, not operating cost). Admin-only. Re-runnable.

create table if not exists public.operating_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null default 'Miscellaneous',
  description text not null default '',
  amount numeric not null default 0,
  paid_to text not null default '',
  payment_method text not null default 'cash',
  recorded_by uuid,
  recorded_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists operating_expenses_date_idx on public.operating_expenses(expense_date);

alter table public.operating_expenses enable row level security;
drop policy if exists "operating_expenses admin all" on public.operating_expenses;
create policy "operating_expenses admin all" on public.operating_expenses
  for all using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

notify pgrst, 'reload schema';
