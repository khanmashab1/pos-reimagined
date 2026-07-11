
CREATE OR REPLACE FUNCTION public.get_profit_report(_from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH sale_line AS (
    SELECT
      si.sale_id,
      coalesce(nullif(si.product_name,''),'Unknown') AS name,
      ((s.created_at AT TIME ZONE 'UTC')::date)     AS d,
      coalesce(si.qty,0)                             AS qty,
      coalesce(si.qty,0) * coalesce(si.unit_price,0) AS gross_revenue,
      coalesce(si.qty,0) * coalesce(si.purchase_price,0) AS cost,
      (coalesce(si.purchase_price,0) = 0)            AS zero_cost,
      coalesce(s.subtotal,0)                         AS sale_subtotal,
      coalesce(s.discount,0)                         AS sale_discount
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.created_at >= _from AND s.created_at <= _to
  ),
  li AS (
    SELECT
      name, d, qty,
      gross_revenue
        - CASE WHEN sale_subtotal > 0
               THEN sale_discount * (gross_revenue / sale_subtotal)
               ELSE 0 END AS revenue,
      cost, zero_cost
    FROM sale_line
  ),
  ret AS (
    SELECT
      coalesce(nullif(ri.product_name,''),'Unknown')                        AS name,
      ((coalesce(r.approved_at, r.created_at) AT TIME ZONE 'UTC')::date)    AS d,
      coalesce(ri.qty,0)                                                    AS qty,
      coalesce(ri.qty,0) * coalesce(ri.unit_price,0)                        AS revenue_ret,
      coalesce(ri.qty,0) * coalesce(si.purchase_price,0)                    AS cost_ret
    FROM public.returns r
    JOIN public.return_items ri ON ri.return_id = r.id
    LEFT JOIN public.sale_items si
      ON si.sale_id = r.original_sale_id AND si.product_id = ri.product_id
    WHERE r.status = 'approved'
      AND coalesce(r.approved_at, r.created_at) >= _from
      AND coalesce(r.approved_at, r.created_at) <= _to
  ),
  combined AS (
    SELECT name, d, qty, revenue, cost, zero_cost FROM li
    UNION ALL
    SELECT name, d, -qty, -revenue_ret, -cost_ret, false FROM ret
  ),
  by_product AS (
    SELECT name,
           sum(qty)     AS qty,
           sum(revenue) AS revenue,
           sum(cost)    AS cost,
           sum(revenue) - sum(cost) AS profit,
           bool_or(zero_cost) AS has_zero_cost
    FROM combined
    GROUP BY name
  ),
  by_day AS (
    SELECT d,
           sum(revenue) - sum(cost) AS profit,
           sum(revenue)             AS sales
    FROM combined
    GROUP BY d
  ),
  tot AS (
    SELECT coalesce(sum(revenue),0) AS revenue,
           coalesce(sum(cost),0)    AS cost,
           coalesce(sum(CASE WHEN zero_cost THEN 1 ELSE 0 END),0) AS zero_count
    FROM combined
  )
  SELECT jsonb_build_object(
    'total_revenue', (SELECT revenue FROM tot),
    'total_cost',    (SELECT cost FROM tot),
    'total_profit',  (SELECT revenue - cost FROM tot),
    'zero_count',    (SELECT zero_count FROM tot),
    'by_product', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name',      name,
        'qty',       qty,
        'revenue',   revenue,
        'cost',      cost,
        'profit',    profit,
        'margin',    CASE WHEN revenue > 0 THEN (profit / revenue) * 100 ELSE NULL END,
        'zero_cost', has_zero_cost
      ) ORDER BY profit DESC)
      FROM by_product), '[]'::jsonb),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'date',   to_char(d,'YYYY-MM-DD'),
        'profit', round(profit),
        'sales',  round(sales)
      ) ORDER BY d)
      FROM by_day), '[]'::jsonb)
  );
$$;
