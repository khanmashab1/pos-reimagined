-- Dashboard v2: extend get_admin_dashboard_summary with cash/online split, gross
-- profit, top cashiers, hourly sales, and a previous-period comparison for trends.
-- Same signature (timestamptz, integer) => clean CREATE OR REPLACE. Re-runnable.

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_summary(_start_at timestamptz, _days integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _gross numeric := 0;
  _bills integer := 0;
  _refunds numeric := 0;
  _returns_count integer := 0;
  _cash numeric := 0;
  _online numeric := 0;
  _profit numeric := 0;
  _daily jsonb := '[]'::jsonb;
  _top_products jsonb := '[]'::jsonb;
  _margin jsonb := '[]'::jsonb;
  _top_cashiers jsonb := '[]'::jsonb;
  _hourly jsonb := '[]'::jsonb;
  -- previous equal-length window
  _prev_start timestamptz;
  _p_gross numeric := 0;
  _p_bills integer := 0;
  _p_refunds numeric := 0;
  _p_profit numeric := 0;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view dashboard analytics';
  end if;

  _days := greatest(1, least(coalesce(_days, 7), 90));
  _prev_start := _start_at - (now() - _start_at);  -- exact elapsed duration before _start_at

  -- Current-period sales totals + cash/online split
  select coalesce(sum(total), 0), count(*)::int,
         coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) = 'cash'), 0),
         coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  into _gross, _bills, _cash, _online
  from public.sales
  where created_at >= _start_at;

  select coalesce(sum(refund_amount), 0), count(*)::int
  into _refunds, _returns_count
  from public.returns
  where status = 'approved'
    and coalesce(approved_at, created_at) >= _start_at;

  -- Current-period gross profit (revenue - cost), same basis as margin buckets below
  select coalesce(sum(si.subtotal - (si.purchase_price * si.qty)), 0)
  into _profit
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.created_at >= _start_at;

  -- Daily sales vs refunds
  with day_series as (
    select generate_series(date_trunc('day', _start_at), date_trunc('day', now()), interval '1 day')::date as day
  ), sales_by_day as (
    select date_trunc('day', created_at)::date as day, sum(total) as sales
    from public.sales where created_at >= _start_at group by 1
  ), returns_by_day as (
    select date_trunc('day', coalesce(approved_at, created_at))::date as day, sum(refund_amount) as refunds
    from public.returns
    where status = 'approved' and coalesce(approved_at, created_at) >= _start_at group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', case when _days = 1 then 'Today' else to_char(ds.day, 'MM-DD') end,
    'sales', round(coalesce(s.sales, 0)),
    'refunds', round(coalesce(r.refunds, 0))
  ) order by ds.day), '[]'::jsonb)
  into _daily
  from day_series ds
  left join sales_by_day s on s.day = ds.day
  left join returns_by_day r on r.day = ds.day;

  -- Top products by qty
  with product_totals as (
    select si.product_name as name, sum(si.qty)::int as qty, sum(si.subtotal) as revenue
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.created_at >= _start_at
    group by si.product_name order by sum(si.qty) desc limit 7
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'revenue', revenue)), '[]'::jsonb)
  into _top_products from product_totals;

  -- Margin distribution buckets
  with margin_buckets as (
    select case
      when si.subtotal > 0 and (((si.subtotal - (si.purchase_price * si.qty)) / si.subtotal) * 100) < 10 then 'Low (<10%)'
      when si.subtotal > 0 and (((si.subtotal - (si.purchase_price * si.qty)) / si.subtotal) * 100) < 30 then 'Mid (10-30%)'
      else 'High (>30%)'
    end as name,
    round(sum(si.subtotal)) as value
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.created_at >= _start_at and si.subtotal > 0
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', value)), '[]'::jsonb)
  into _margin from margin_buckets where value > 0;

  -- Top cashiers by sales
  with cashier_totals as (
    select coalesce(nullif(cashier_name,''), 'Unknown') as name,
           sum(total) as sales, count(*)::int as bills
    from public.sales where created_at >= _start_at
    group by 1 order by sum(total) desc limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'sales', round(sales), 'bills', bills)
    order by sales desc), '[]'::jsonb)
  into _top_cashiers from cashier_totals;

  -- Sales by hour of day (local Karachi time), zero-filled 0..23
  with hours as (
    select generate_series(0, 23) as hour
  ), sales_by_hour as (
    select extract(hour from (created_at at time zone 'Asia/Karachi'))::int as hour, sum(total) as sales
    from public.sales where created_at >= _start_at group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('hour', h.hour, 'sales', round(coalesce(sh.sales, 0)))
    order by h.hour), '[]'::jsonb)
  into _hourly
  from hours h left join sales_by_hour sh on sh.hour = h.hour;

  -- Previous-period comparison (gross, bills, refunds->net, profit)
  select coalesce(sum(total), 0), count(*)::int
  into _p_gross, _p_bills
  from public.sales where created_at >= _prev_start and created_at < _start_at;

  select coalesce(sum(refund_amount), 0)
  into _p_refunds
  from public.returns
  where status = 'approved'
    and coalesce(approved_at, created_at) >= _prev_start
    and coalesce(approved_at, created_at) < _start_at;

  select coalesce(sum(si.subtotal - (si.purchase_price * si.qty)), 0)
  into _p_profit
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.created_at >= _prev_start and s.created_at < _start_at;

  return jsonb_build_object(
    'grossSales', _gross,
    'bills', _bills,
    'refunds', _refunds,
    'net', _gross - _refunds,
    'rate', case when _gross > 0 then (_refunds / _gross) * 100 else 0 end,
    'returnsCount', _returns_count,
    'cashSales', _cash,
    'onlineSales', _online,
    'grossProfit', _profit,
    'daily', _daily,
    'topProducts', _top_products,
    'margin', _margin,
    'topCashiers', _top_cashiers,
    'hourly', _hourly,
    'prev', jsonb_build_object(
      'grossSales', _p_gross,
      'bills', _p_bills,
      'net', _p_gross - _p_refunds,
      'grossProfit', _p_profit
    )
  );
end;
$$;

revoke execute on function public.get_admin_dashboard_summary(timestamptz, integer) from public, anon;
grant  execute on function public.get_admin_dashboard_summary(timestamptz, integer) to authenticated;

notify pgrst, 'reload schema';
