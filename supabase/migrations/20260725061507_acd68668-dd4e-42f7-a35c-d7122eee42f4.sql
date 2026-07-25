update public.manual_sale_days
set cash_by_person = jsonb_set(cash_by_person, '{Junaid,paid}', '0'::jsonb)
where entry_date = '2026-06-30';