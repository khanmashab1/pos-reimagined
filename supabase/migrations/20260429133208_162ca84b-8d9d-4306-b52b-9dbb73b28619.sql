create or replace function public.get_admin_dashboard_summary(_start_at timestamptz, _days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _gross numeric := 0;
  _bills integer := 0;
  _refunds numeric := 0;
  _returns_count integer := 0;
  _daily jsonb := '[]'::jsonb;
  _top_products jsonb := '[]'::jsonb;
  _margin jsonb := '[]'::jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view dashboard analytics';
  end if;

  _days := greatest(1, least(coalesce(_days, 7), 90));

  select coalesce(sum(total), 0), count(*)::int
  into _gross, _bills
  from public.sales
  where created_at >= _start_at;

  select coalesce(sum(refund_amount), 0), count(*)::int
  into _refunds, _returns_count
  from public.returns
  where status = 'approved'
    and coalesce(approved_at, created_at) >= _start_at;

  with day_series as (
    select generate_series(
      date_trunc('day', _start_at),
      date_trunc('day', now()),
      interval '1 day'
    )::date as day
  ), sales_by_day as (
    select date_trunc('day', created_at)::date as day, sum(total) as sales
    from public.sales
    where created_at >= _start_at
    group by 1
  ), returns_by_day as (
    select date_trunc('day', coalesce(approved_at, created_at))::date as day, sum(refund_amount) as refunds
    from public.returns
    where status = 'approved'
      and coalesce(approved_at, created_at) >= _start_at
    group by 1
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

  with product_totals as (
    select si.product_name as name,
           sum(si.qty)::int as qty,
           sum(si.subtotal) as revenue
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where s.created_at >= _start_at
    group by si.product_name
    order by sum(si.qty) desc
    limit 7
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', name,
    'qty', qty,
    'revenue', revenue
  )), '[]'::jsonb)
  into _top_products
  from product_totals;

  with margin_buckets as (
    select case
      when si.subtotal > 0 and (((si.subtotal - (si.purchase_price * si.qty)) / si.subtotal) * 100) < 10 then 'Low (<10%)'
      when si.subtotal > 0 and (((si.subtotal - (si.purchase_price * si.qty)) / si.subtotal) * 100) < 30 then 'Mid (10-30%)'
      else 'High (>30%)'
    end as name,
    round(sum(si.subtotal)) as value
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where s.created_at >= _start_at
      and si.subtotal > 0
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', value)), '[]'::jsonb)
  into _margin
  from margin_buckets
  where value > 0;

  return jsonb_build_object(
    'grossSales', _gross,
    'bills', _bills,
    'refunds', _refunds,
    'net', _gross - _refunds,
    'rate', case when _gross > 0 then (_refunds / _gross) * 100 else 0 end,
    'returnsCount', _returns_count,
    'daily', _daily,
    'topProducts', _top_products,
    'margin', _margin
  );
end;
$$;

create or replace function public.get_admin_inventory_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.has_role(auth.uid(), 'admin') then
      jsonb_build_object('products', 0, 'lowStock', 0, 'lowStockItems', '[]'::jsonb)
    else (
      select jsonb_build_object(
        'products', count(*)::int,
        'lowStock', count(*) filter (where stock <= min_stock_alert)::int,
        'lowStockItems', coalesce(jsonb_agg(
          jsonb_build_object(
            'id', id,
            'name', name,
            'stock', stock,
            'min_stock_alert', min_stock_alert
          ) order by stock asc
        ) filter (where stock <= min_stock_alert), '[]'::jsonb)
      )
      from public.products
    )
  end
$$;

create index if not exists idx_returns_status_approved_created on public.returns(status, approved_at desc, created_at desc);
create index if not exists idx_sale_items_product_name on public.sale_items(product_name);

revoke execute on function public.get_admin_dashboard_summary(timestamptz, integer) from public, anon;
grant execute on function public.get_admin_dashboard_summary(timestamptz, integer) to authenticated;
revoke execute on function public.get_admin_inventory_summary() from public, anon;
grant execute on function public.get_admin_inventory_summary() to authenticated;