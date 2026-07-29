
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
    SELECT btrim(se.description) AS nm, SUM(se.amount)::numeric AS amt
    FROM public.shift_expenses se, ledger_start
    WHERE se.created_at >= (ledger_start.d::text || 'T00:00:00+05:00')::timestamptz
      AND btrim(coalesce(se.description,'')) <> ''
    GROUP BY btrim(se.description)
  ),
  paid_pp AS (
    SELECT btrim(pp.person_name) AS nm, SUM(pp.amount)::numeric AS amt
    FROM public.person_payments pp, ledger_start
    WHERE pp.payment_date >= ledger_start.d
    GROUP BY btrim(pp.person_name)
  ),
  paid_op AS (
    SELECT btrim(oe.paid_to) AS nm, SUM(oe.amount)::numeric AS amt
    FROM public.operating_expenses oe, ledger_start
    WHERE oe.expense_date >= ledger_start.d
      AND btrim(coalesce(oe.paid_to,'')) <> ''
    GROUP BY btrim(oe.paid_to)
  ),
  starting AS (
    SELECT btrim(psb.person_name) AS nm, psb.balance::numeric AS amt
    FROM public.person_starting_balances psb
  ),
  all_names AS (
    SELECT nm FROM received
    UNION SELECT nm FROM paid_pp
    UNION SELECT nm FROM paid_op
    UNION SELECT nm FROM starting
  ),
  computed AS (
    SELECT
      n.nm AS nm,
      (COALESCE((SELECT amt FROM starting s WHERE s.nm = n.nm), 0)
       + COALESCE((SELECT amt FROM received r WHERE r.nm = n.nm), 0)
       - COALESCE((SELECT amt FROM paid_pp p WHERE p.nm = n.nm), 0)
       - COALESCE((SELECT amt FROM paid_op o WHERE o.nm = n.nm), 0))::numeric AS bal
    FROM all_names n
    WHERE lower(n.nm) NOT IN ('junaid','usama')
      AND n.nm <> ''
  )
  SELECT c.nm AS person_name, c.bal AS balance
  FROM computed c
  WHERE c.bal > 0
  ORDER BY c.bal DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_credit_customers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_credit_customers() TO authenticated;
