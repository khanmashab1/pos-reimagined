-- Person payments (money paid to / handled by Junaid, Usama, etc.) with method,
-- so the "By Person" totals are an auditable ledger instead of a manual number.
-- Admin-only. Re-runnable.

create table if not exists public.person_payments (
  id uuid primary key default gen_random_uuid(),
  payment_date date not null,
  person_name text not null default '',
  amount numeric not null default 0,
  payment_method text not null default 'cash',
  notes text not null default '',
  recorded_by uuid,
  recorded_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists person_payments_date_idx on public.person_payments(payment_date);

alter table public.person_payments enable row level security;
drop policy if exists "person_payments admin all" on public.person_payments;
create policy "person_payments admin all" on public.person_payments
  for all using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

notify pgrst, 'reload schema';
