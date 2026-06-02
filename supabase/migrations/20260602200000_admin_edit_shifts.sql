
-- Allow admins to update cash sessions (edit shift details)
CREATE POLICY "sessions admin update" ON public.cash_sessions
  FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Admin function to update shift fields
create or replace function public.admin_update_shift(
  _session_id uuid,
  _opening_cash numeric default null,
  _closing_cash numeric default null,
  _cash_sales numeric default null,
  _expected_cash numeric default null,
  _difference numeric default null,
  _user_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _existing record;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can edit shifts';
  end if;

  select * into _existing from public.cash_sessions where id = _session_id;
  if _existing.id is null then raise exception 'Shift not found'; end if;

  update public.cash_sessions
    set opening_cash = coalesce(_opening_cash, _existing.opening_cash),
        closing_cash = coalesce(_closing_cash, _existing.closing_cash),
        cash_sales = coalesce(_cash_sales, _existing.cash_sales),
        expected_cash = coalesce(_expected_cash, _existing.expected_cash),
        difference = coalesce(_difference, _existing.difference),
        user_name = coalesce(_user_name, _existing.user_name)
    where id = _session_id;

  return jsonb_build_object('session_id', _session_id, 'status', 'updated');
end;
$$;

revoke execute on function public.admin_update_shift(uuid, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
grant  execute on function public.admin_update_shift(uuid, numeric, numeric, numeric, numeric, numeric, text) to authenticated;
