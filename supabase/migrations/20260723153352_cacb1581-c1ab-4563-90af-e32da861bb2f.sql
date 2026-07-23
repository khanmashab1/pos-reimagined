DELETE FROM public.manual_sale_days WHERE entry_date = '2026-06-30';
UPDATE public.manual_sale_days SET entry_date = '2026-06-30' WHERE entry_date = '2025-06-30';