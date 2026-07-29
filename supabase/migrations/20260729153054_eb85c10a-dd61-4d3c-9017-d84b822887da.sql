
CREATE OR REPLACE FUNCTION public.get_credit_customers()
RETURNS TABLE(person_name text, balance numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ledger_start AS (SELECT DATE '2026-06-30' AS d),
  received AS (
    SELECT btrim(description) AS name, SUM(amount)::numeric AS amt
    FROM public.shift_expenses, ledger_start
    WHERE created_at >= (d::text || 'T00:00:00+05:00')::timestamptz
      AND btrim(coalesce(description,'')) <> ''
    GROUP BY btrim(description)
  ),
  paid_pp AS (
    SELECT btrim(person_name) AS name, SUM(amount)::numeric AS amt
    FROM public.person_payments, ledger_start
    WHERE payment_date >= d
    GROUP BY btrim(person_name)
  ),
  paid_op AS (
    SELECT btrim(paid_to) AS name, SUM(amount)::numeric AS amt
    FROM public.operating_expenses, ledger_start
    WHERE expense_date >= d
      AND btrim(coalesce(paid_to,'')) <> ''
    GROUP BY btrim(paid_to)
  ),
  starting AS (
    SELECT btrim(person_name) AS name, balance::numeric AS amt
    FROM public.person_starting_balances
  ),
  all_names AS (
    SELECT name FROM received
    UNION SELECT name FROM paid_pp
    UNION SELECT name FROM paid_op
    UNION SELECT name FROM starting
  )
  SELECT
    n.name,
    (COALESCE((SELECT amt FROM starting s WHERE s.name = n.name), 0)
     + COALESCE((SELECT amt FROM received r WHERE r.name = n.name), 0)
     - COALESCE((SELECT amt FROM paid_pp p WHERE p.name = n.name), 0)
     - COALESCE((SELECT amt FROM paid_op o WHERE o.name = n.name), 0))::numeric AS balance
  FROM all_names n
  WHERE lower(n.name) NOT IN ('junaid','usama')
    AND n.name <> ''
  HAVING (COALESCE((SELECT amt FROM starting s WHERE s.name = n.name), 0)
        + COALESCE((SELECT amt FROM received r WHERE r.name = n.name), 0)
        - COALESCE((SELECT amt FROM paid_pp p WHERE p.name = n.name), 0)
        - COALESCE((SELECT amt FROM paid_op o WHERE o.name = n.name), 0)) > 0
  ORDER BY balance DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_credit_customers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_credit_customers() TO authenticated;
