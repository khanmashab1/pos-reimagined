-- Server-side aggregation for the Profit Calculator.
-- Replaces pulling every sale + sale_item to the browser: this computes the
-- totals, per-product breakdown, and daily trend in one query and returns a
-- compact JSON payload. Re-runnable (CREATE OR REPLACE only).
--
-- Revenue/cost match the prior client logic exactly:
--   revenue = qty * unit_price,  cost = qty * purchase_price,  zero_count = items with purchase_price = 0.
-- Daily buckets use the UTC date to match the old `new Date(created_at).toISOString()` behavior.

CREATE OR REPLACE FUNCTION public.get_profit_report(_from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH li AS (
    SELECT
      coalesce(nullif(si.product_name, ''), 'Unknown')        AS name,
      ((s.created_at AT TIME ZONE 'UTC')::date)               AS d,
      coalesce(si.qty, 0)                                     AS qty,
      coalesce(si.qty, 0) * coalesce(si.unit_price, 0)        AS revenue,
      coalesce(si.qty, 0) * coalesce(si.purchase_price, 0)    AS cost,
      (coalesce(si.purchase_price, 0) = 0)                    AS zero_cost
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.created_at >= _from AND s.created_at <= _to
  ),
  by_product AS (
    SELECT name, sum(qty) AS qty, sum(revenue) AS revenue, sum(cost) AS cost,
           sum(revenue) - sum(cost) AS profit
    FROM li GROUP BY name
  ),
  by_day AS (
    SELECT d, sum(revenue) - sum(cost) AS profit, sum(revenue) AS sales
    FROM li GROUP BY d
  ),
  tot AS (
    SELECT coalesce(sum(revenue), 0) AS revenue,
           coalesce(sum(cost), 0)    AS cost,
           coalesce(sum(CASE WHEN zero_cost THEN 1 ELSE 0 END), 0) AS zero_count
    FROM li
  )
  SELECT jsonb_build_object(
    'total_revenue', (SELECT revenue FROM tot),
    'total_cost',    (SELECT cost FROM tot),
    'total_profit',  (SELECT revenue - cost FROM tot),
    'zero_count',    (SELECT zero_count FROM tot),
    'by_product', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name', name, 'qty', qty, 'revenue', revenue, 'cost', cost, 'profit', profit,
        'margin', CASE WHEN revenue > 0 THEN (profit / revenue) * 100 ELSE 0 END
      ) ORDER BY profit DESC)
      FROM by_product), '[]'::jsonb),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(d, 'YYYY-MM-DD'), 'profit', round(profit), 'sales', round(sales)
      ) ORDER BY d)
      FROM by_day), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_profit_report(timestamptz, timestamptz) TO authenticated;

notify pgrst, 'reload schema';
