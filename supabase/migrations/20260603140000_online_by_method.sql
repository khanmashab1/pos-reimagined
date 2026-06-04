-- Sum of sales by payment method over a date range, for attributing online
-- payments to people on the Daily Expenses Report (card + easypasa -> Junaid,
-- jazzcash -> Usama). Admin-only. Re-runnable.

create or replace function public.get_online_by_method(_from timestamptz, _to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare _r jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view sales analytics';
  end if;
  select coalesce(jsonb_object_agg(pt, amt), '{}'::jsonb) into _r
  from (
    select lower(trim(coalesce(payment_type, 'cash'))) as pt, sum(total) as amt
    from public.sales
    where created_at >= _from and created_at <= _to
    group by 1
  ) s;
  return _r;
end;
$$;

revoke execute on function public.get_online_by_method(timestamptz, timestamptz) from public, anon;
grant  execute on function public.get_online_by_method(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
