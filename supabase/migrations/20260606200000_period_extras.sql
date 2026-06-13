-- Extra period figures for the Dashboard: discounts given, stock purchased
-- (supplier payments — inventory investment, NOT an operating cost), and
-- operating expenses. Isolated RPC so it doesn't touch the larger summary fn.

create or replace function public.get_period_extras(_from timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare _r jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view dashboard analytics';
  end if;
  select jsonb_build_object(
    'discounts',          coalesce((select sum(discount) from public.sales where created_at >= _from), 0),
    'stockPurchased',     coalesce((select sum(amount)   from public.supplier_payments where created_at >= _from), 0),
    'operatingExpenses',  coalesce((select sum(amount)   from public.operating_expenses where created_at >= _from), 0)
  ) into _r;
  return _r;
end;
$$;

revoke execute on function public.get_period_extras(timestamptz) from public, anon;
grant  execute on function public.get_period_extras(timestamptz) to authenticated;

notify pgrst, 'reload schema';
