CREATE OR REPLACE FUNCTION public.get_admin_dashboard_summary(_start_at timestamp with time zone, _days integer, _end_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _end timestamptz;
  _gross numeric := 0; _bills integer := 0; _refunds numeric := 0; _returns_count integer := 0;
  _cash numeric := 0; _online numeric := 0; _profit numeric := 0;
  _daily jsonb := '[]'::jsonb; _top_products jsonb := '[]'::jsonb;
  _margin jsonb := '[]'::jsonb; _top_cashiers jsonb := '[]'::jsonb; _hourly jsonb := '[]'::jsonb;
  _prev_start timestamptz; _prev_end timestamptz;
  _p_gross numeric := 0; _p_bills integer := 0; _p_refunds numeric := 0; _p_profit numeric := 0;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view dashboard analytics';
  end if;

  _end := coalesce(_end_at, now());
  _days := greatest(1, least(coalesce(_days, 7), 366));
  _prev_end := _start_at;
  _prev_start := _start_at - (_end - _start_at);

  select coalesce(sum(total),0), count(*)::int,
         coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) =  'cash'), 0),
         coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  into _gross, _bills, _cash, _online
  from public.sales where created_at >= _start_at and created_at <= _end;

  select coalesce(sum(refund_amount),0), count(*)::int
  into _refunds, _returns_count
  from public.returns
  where status='approved'
    and coalesce(approved_at, created_at) >= _start_at
    and coalesce(approved_at, created_at) <= _end;

  select coalesce(sum(si.subtotal - (si.purchase_price * si.qty)), 0)
  into _profit
  from public.sale_items si join public.sales s on s.id=si.sale_id
  where s.created_at >= _start_at and s.created_at <= _end;

  with day_series as (
    select generate_series(date_trunc('day',_start_at), date_trunc('day',_end), interval '1 day')::date as day
  ), sales_by_day as (
    select date_trunc('day',created_at)::date as day, sum(total) as sales
    from public.sales where created_at >= _start_at and created_at <= _end group by 1
  ), returns_by_day as (
    select date_trunc('day', coalesce(approved_at, created_at))::date as day, sum(refund_amount) as refunds
    from public.returns
    where status='approved' and coalesce(approved_at, created_at) >= _start_at and coalesce(approved_at, created_at) <= _end
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', case when _days = 1 then 'Today' else to_char(ds.day, 'MM-DD') end,
    'sales', round(coalesce(s.sales,0)),
    'refunds', round(coalesce(r.refunds,0))
  ) order by ds.day), '[]'::jsonb)
  into _daily
  from day_series ds left join sales_by_day s on s.day=ds.day left join returns_by_day r on r.day=ds.day;

  with product_totals as (
    select si.product_name as name, sum(si.qty)::int as qty, sum(si.subtotal) as revenue
    from public.sale_items si join public.sales s on s.id=si.sale_id
    where s.created_at >= _start_at and s.created_at <= _end
    group by si.product_name order by sum(si.qty) desc limit 7
  )
  select coalesce(jsonb_agg(jsonb_build_object('name',name,'qty',qty,'revenue',revenue)), '[]'::jsonb)
  into _top_products from product_totals;

  with margin_buckets as (
    select case
      when si.subtotal>0 and (((si.subtotal-(si.purchase_price*si.qty))/si.subtotal)*100) < 10 then 'Low (<10%)'
      when si.subtotal>0 and (((si.subtotal-(si.purchase_price*si.qty))/si.subtotal)*100) < 30 then 'Mid (10-30%)'
      else 'High (>30%)' end as name,
      round(sum(si.subtotal)) as value
    from public.sale_items si join public.sales s on s.id=si.sale_id
    where s.created_at >= _start_at and s.created_at <= _end and si.subtotal>0
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('name',name,'value',value)), '[]'::jsonb)
  into _margin from margin_buckets where value>0;

  with cashier_totals as (
    select coalesce(nullif(cashier_name,''),'Unknown') as name, sum(total) as sales, count(*)::int as bills
    from public.sales where created_at >= _start_at and created_at <= _end
    group by 1 order by sum(total) desc limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object('name',name,'sales',round(sales),'bills',bills) order by sales desc), '[]'::jsonb)
  into _top_cashiers from cashier_totals;

  with hours as (select generate_series(0,23) as hour),
  sales_by_hour as (
    select extract(hour from (created_at at time zone 'Asia/Karachi'))::int as hour, sum(total) as sales
    from public.sales where created_at >= _start_at and created_at <= _end group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('hour',h.hour,'sales',round(coalesce(sh.sales,0))) order by h.hour), '[]'::jsonb)
  into _hourly from hours h left join sales_by_hour sh on sh.hour=h.hour;

  select coalesce(sum(total),0), count(*)::int
  into _p_gross, _p_bills
  from public.sales where created_at >= _prev_start and created_at < _prev_end;

  select coalesce(sum(refund_amount),0) into _p_refunds
  from public.returns where status='approved'
    and coalesce(approved_at, created_at) >= _prev_start and coalesce(approved_at, created_at) < _prev_end;

  select coalesce(sum(si.subtotal-(si.purchase_price*si.qty)),0) into _p_profit
  from public.sale_items si join public.sales s on s.id=si.sale_id
  where s.created_at >= _prev_start and s.created_at < _prev_end;

  return jsonb_build_object(
    'grossSales',_gross,'bills',_bills,'refunds',_refunds,
    'net', _gross - _refunds, 'rate', case when _gross>0 then (_refunds/_gross)*100 else 0 end,
    'returnsCount',_returns_count,'cashSales',_cash,'onlineSales',_online,'grossProfit',_profit,
    'daily',_daily,'topProducts',_top_products,'margin',_margin,'topCashiers',_top_cashiers,'hourly',_hourly,
    'prev', jsonb_build_object('grossSales',_p_gross,'bills',_p_bills,'net',_p_gross-_p_refunds,'grossProfit',_p_profit)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_period_extras(_from timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _r jsonb; _end timestamptz;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view dashboard analytics';
  end if;
  _end := coalesce(_to, now());
  select jsonb_build_object(
    'discounts',         coalesce((select sum(discount) from public.sales where created_at >= _from and created_at <= _end), 0),
    'stockPurchased',    coalesce((select sum(amount)   from public.supplier_payments where created_at >= _from and created_at <= _end), 0),
    'operatingExpenses', coalesce((select sum(amount)   from public.operating_expenses where created_at >= _from and created_at <= _end), 0)
  ) into _r;
  return _r;
end;
$function$;